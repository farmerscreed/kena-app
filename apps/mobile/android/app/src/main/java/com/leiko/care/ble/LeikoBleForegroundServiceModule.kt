package com.leiko.care.ble

import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod

class LeikoBleForegroundServiceModule(
  private val context: ReactApplicationContext,
) : ReactContextBaseJavaModule(context) {

  override fun getName(): String = "LeikoBleForegroundService"

  @ReactMethod
  fun start(promise: Promise) {
    try {
      LeikoBleForegroundService.start(context)
      promise.resolve(true)
    } catch (e: Exception) {
      promise.reject("ble_fg_start_failed", e.message, e)
    }
  }

  @ReactMethod
  fun stop(promise: Promise) {
    try {
      LeikoBleForegroundService.stop(context)
      promise.resolve(true)
    } catch (e: Exception) {
      promise.reject("ble_fg_stop_failed", e.message, e)
    }
  }

  // Wall-clock delay that fires even when React Native's TimingModule is
  // paused. An OS-woken headless process has never had a resumed activity,
  // so setTimeout callbacks are queued but never dispatched — which
  // silently disarmed every BLE/upload timeout during background sync
  // (2026-08-15: runs hung 20+ minutes on a 5 s command timeout). A
  // Handler on the main looper is driven by the OS, not the RN lifecycle.
  @ReactMethod
  fun delay(ms: Double, promise: Promise) {
    try {
      android.os.Handler(android.os.Looper.getMainLooper()).postDelayed(
        { promise.resolve(true) },
        ms.toLong().coerceAtLeast(0L),
      )
    } catch (e: Exception) {
      promise.reject("ble_fg_delay_failed", e.message, e)
    }
  }
}
