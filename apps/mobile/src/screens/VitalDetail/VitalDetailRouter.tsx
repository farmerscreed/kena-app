// VitalDetailRouter — Sprint 8.5.
//
// Single screen registered in the SelfBuyer navigation stack at the
// `VitalDetail` route. Reads `route.params.vital` and renders the right
// per-vital detail screen. Each detail screen is a presentational
// component that receives `onBack` (and `onSelectReading` for BPDetail);
// the router owns the navigation hooks so the screens stay testable
// without a NavigationContainer.
//
// Replaces the Sprint 8 `VitalDetailPlaceholder` — the placeholder
// remains in the codebase under `screens/Placeholders/` for reference
// but is no longer registered in the navigator.

import { useCallback } from 'react';
import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { BPDetail } from './BPDetail';
import { HRDetail } from './HRDetail';
import { SpO2Detail } from './SpO2Detail';
import { SleepDetail } from './SleepDetail';
import { ActivityDetail } from './ActivityDetail';
import type { SelfBuyerStackParamList } from '../../navigation/types';

export function VitalDetailRouter() {
  const navigation =
    useNavigation<NativeStackNavigationProp<SelfBuyerStackParamList>>();
  const route = useRoute<RouteProp<SelfBuyerStackParamList, 'VitalDetail'>>();
  const onBack = useCallback(() => navigation.goBack(), [navigation]);
  const onSelectReading = useCallback(
    (readingLocalId: string) => {
      navigation.navigate('ReadingDetail', { readingLocalId });
    },
    [navigation],
  );
  const onArticleOpen = useCallback(
    (articleId: string) => {
      navigation.navigate('Article', { articleId });
    },
    [navigation],
  );
  const onLearnOpen = useCallback(() => {
    navigation.navigate('Learn');
  }, [navigation]);

  // Sprint 17a — optional caregiver entry. When present, every detail
  // screen sources its data from the parent-scoped query layer; the
  // router just forwards the route param.
  const familyId = route.params.familyId;

  // Sprint 18 B3 — Sprint 16.5f shipped the "Share with your doctor"
  // row on BPDetail but the router forgot to pass `onSharePress`, so
  // the affordance never reached users. Route the tap to the
  // dedicated `ForYourDoctor` screen where the doctor-prep PDF
  // generator already lives.
  const onSharePress = useCallback(() => {
    navigation.navigate('ForYourDoctor');
  }, [navigation]);

  // ADR-0008 follow-up — "View all · N" under the recent lists opens the
  // full-window VitalHistory browse. The detail screen resolves the
  // family + wearer tz (it already has both); the router owns navigation
  // and curries the vital kind. HR is excluded (per-day drill-down later).
  const onViewAllHistory = useCallback(
    (
      vital: 'bp' | 'spo2' | 'sleep' | 'activity',
      range: '7d' | '30d' | '90d',
      historyFamilyId: string,
      timeZone: string,
    ) => {
      navigation.navigate('VitalHistory', {
        vital,
        range,
        familyId: historyFamilyId,
        timeZone,
      });
    },
    [navigation],
  );

  switch (route.params.vital) {
    case 'bp':
      return (
        <BPDetail
          onBack={onBack}
          onDoctorPress={onSharePress}
          onSelectReading={onSelectReading}
          onArticleOpen={onArticleOpen}
          onLearnOpen={onLearnOpen}
          onSharePress={onSharePress}
          familyId={familyId}
          onViewAllHistory={(range, fid, tz) =>
            onViewAllHistory('bp', range, fid, tz)
          }
        />
      );
    case 'hr':
      return (
        <HRDetail
          onBack={onBack}
          onDoctorPress={onSharePress}
          onArticleOpen={onArticleOpen}
          onLearnOpen={onLearnOpen}
          familyId={familyId}
        />
      );
    case 'spo2':
      return (
        <SpO2Detail
          onBack={onBack}
          onDoctorPress={onSharePress}
          onArticleOpen={onArticleOpen}
          onLearnOpen={onLearnOpen}
          familyId={familyId}
          onViewAllHistory={(range, fid, tz) =>
            onViewAllHistory('spo2', range, fid, tz)
          }
        />
      );
    case 'sleep':
      return (
        <SleepDetail
          onBack={onBack}
          onDoctorPress={onSharePress}
          onArticleOpen={onArticleOpen}
          onLearnOpen={onLearnOpen}
          familyId={familyId}
          onViewAllHistory={(range, fid, tz) =>
            onViewAllHistory('sleep', range, fid, tz)
          }
        />
      );
    case 'activity':
      return (
        <ActivityDetail
          onBack={onBack}
          onDoctorPress={onSharePress}
          onArticleOpen={onArticleOpen}
          onLearnOpen={onLearnOpen}
          familyId={familyId}
          onViewAllHistory={(range, fid, tz) =>
            onViewAllHistory('activity', range, fid, tz)
          }
        />
      );
  }
}
