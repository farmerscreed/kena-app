// Typed wrapper around a connected react-native-ble-plx Device. One
// instance per active connection. Holds the Notify subscription, exposes
// a sendCommand primitive that writes a 16-byte packet and (optionally)
// awaits the matching response. Per docs/06-ble-protocol.md §3.

import type { Device, Subscription } from 'react-native-ble-plx';
import { logger } from '../analytics/logger';
import { raceWithHeadlessTimeout } from './headlessDelay';
import {
  CrcError,
  ParsedPacket,
  ResponseValidator,
  URION_NOTIFY_CHAR_UUID,
  URION_SERVICE_UUID,
  URION_WRITE_CHAR_UUID,
  base64ToBytes,
  buildPacket,
  bytesToBase64,
  parsePacket,
} from './io';

// BLE_TRACE — Sprint 16.5a Phase A forensic-capture instrumentation.
// Gated behind __DEV__ so dev sideloads + Metro builds emit traces but
// any TestFlight / Play Internal / production build skips the logs
// entirely (cheap boolean short-circuit at every call site). Strip both
// flag and call sites per the sprint's Step 4 before any release.
const BLE_TRACE = typeof __DEV__ !== 'undefined' && __DEV__;

function hex2(n: number): string {
  return (n & 0xff).toString(16).padStart(2, '0');
}

export type NotifyHandler = (packet: ParsedPacket) => void;

export class CommandTimeoutError extends Error {
  constructor(public readonly command: number, public readonly timeoutMs: number) {
    super(`Command 0x${command.toString(16)} timed out after ${timeoutMs}ms`);
    this.name = 'CommandTimeoutError';
  }
}

export class UrionDevice {
  readonly id: string;
  readonly name: string | null;
  private notifySub: Subscription | null = null;
  private listeners = new Set<NotifyHandler>();

  constructor(private readonly device: Device) {
    this.id = device.id;
    this.name = device.name ?? device.localName ?? null;
  }

  /** Last 4 hex chars of the MAC, lower-case, no separators. UI display. */
  get macSuffix(): string {
    return this.id.replace(/[^0-9a-f]/gi, '').slice(-4).toLowerCase();
  }

  async startNotify(): Promise<void> {
    if (this.notifySub) return;
    this.notifySub = this.device.monitorCharacteristicForService(
      URION_SERVICE_UUID,
      URION_NOTIFY_CHAR_UUID,
      (error, characteristic) => {
        if (error) {
          logger.track('ble_disconnected', { deviceId: this.id, reason: error.message });
          return;
        }
        const value = characteristic?.value;
        if (!value) return;
        try {
          const packet = parsePacket(base64ToBytes(value));
          if (BLE_TRACE) {
            const p = packet.payload;
            console.log(
              `[ble-trace] notify cmd=0x${hex2(packet.command)} ` +
                `payload[0..3]=${hex2(p[0] ?? 0)} ${hex2(p[1] ?? 0)} ` +
                `${hex2(p[2] ?? 0)} ${hex2(p[3] ?? 0)} ` +
                `listeners=${this.listeners.size}`,
            );
          }
          for (const l of this.listeners) l(packet);
        } catch (e) {
          if (e instanceof CrcError) {
            if (BLE_TRACE) console.log(`[ble-trace] CRC fail deviceId=${this.id}`);
            logger.track('ble_crc_fail', { deviceId: this.id });
            return;
          }
          throw e;
        }
      },
    );
  }

  onNotify(handler: NotifyHandler): () => void {
    this.listeners.add(handler);
    return () => this.listeners.delete(handler);
  }

  /**
   * Subscribe to disconnection events on the underlying Device.
   * Fires whether the disconnect was caller-initiated (cancelConnection)
   * or remote (out-of-range, OEM kill, watch power-off). Returns an
   * unsubscribe function.
   */
  onDisconnected(handler: () => void): () => void {
    const sub = this.device.onDisconnected(() => handler());
    return () => sub.remove();
  }

  async writePacket(packet: Uint8Array): Promise<void> {
    await this.device.writeCharacteristicWithoutResponseForService(
      URION_SERVICE_UUID,
      URION_WRITE_CHAR_UUID,
      bytesToBase64(packet),
    );
  }

  async sendCommand(
    command: number,
    payload?: Uint8Array | readonly number[],
    validator?: ResponseValidator,
    timeoutMs = 5_000,
  ): Promise<ParsedPacket | undefined> {
    const packet = buildPacket(command, payload);
    if (!validator) {
      await this.writePacket(packet);
      return undefined;
    }
    const response = this.awaitResponse(validator, command, timeoutMs);
    // Swallow the race's late rejection if the write itself throws and
    // the caller therefore never awaits `response`.
    response.catch(() => {});
    await this.writePacket(packet);
    return response;
  }

  // Deadline via raceWithHeadlessTimeout, NOT setTimeout: RN never
  // dispatches JS timers in an OS-woken headless process, which turned
  // this 5 s recovery into an infinite hang whenever the watch stopped
  // answering mid-protocol (§9, 2026-08-15).
  private awaitResponse(
    validator: ResponseValidator,
    command: number,
    timeoutMs: number,
  ): Promise<ParsedPacket> {
    let unsub: () => void = () => {};
    const matched = new Promise<ParsedPacket>((resolve) => {
      unsub = this.onNotify((packet) => {
        if (validator(packet)) {
          unsub();
          resolve(packet);
        }
      });
    });
    return raceWithHeadlessTimeout(matched, timeoutMs, () => {
      unsub();
      return new CommandTimeoutError(command, timeoutMs);
    });
  }

  /**
   * For commands that stream multiple response packets ending in a
   * sentinel — most importantly 0x14 readBPHistory which returns one
   * packet per reading + a `0xFFFFFFFF` terminator. Collects every
   * matching packet (including the terminator) and resolves when the
   * terminator predicate fires. Rejects with CommandTimeoutError if
   * no terminator arrives within `timeoutMs`.
   */
  async sendCommandStream(
    command: number,
    payload: Uint8Array | readonly number[] | undefined,
    isTerminator: (packet: ParsedPacket) => boolean,
    options: { timeoutMs?: number } = {},
  ): Promise<ParsedPacket[]> {
    const timeoutMs = options.timeoutMs ?? 10_000;
    const packet = buildPacket(command, payload);
    const collected: ParsedPacket[] = [];
    let unsub: () => void = () => {};
    const stream = new Promise<ParsedPacket[]>((resolve) => {
      unsub = this.onNotify((p) => {
        if (p.command !== command) return;
        collected.push(p);
        if (isTerminator(p)) {
          unsub();
          resolve(collected);
        }
      });
    });
    try {
      await this.writePacket(packet);
    } catch (e) {
      unsub();
      throw e;
    }
    // Same headless-safe deadline rationale as awaitResponse (§9).
    return raceWithHeadlessTimeout(stream, timeoutMs, () => {
      unsub();
      return new CommandTimeoutError(command, timeoutMs);
    });
  }

  async disconnect(): Promise<void> {
    this.notifySub?.remove();
    this.notifySub = null;
    this.listeners.clear();
    try {
      await this.device.cancelConnection();
    } catch {
      // already disconnected — fine
    }
  }
}
