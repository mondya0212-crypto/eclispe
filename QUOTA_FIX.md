# 사용량 초과 방지 수정사항

이번 수정본은 Supabase의 `exceed_egress_quota`, `exceed_realtime_message_count_quota` 재발 가능성을 낮추기 위해 다음을 변경했습니다.

- Google Sheets 보스/출석 3~5초 자동 폴링 제거
- Google Sheets 길드원 30초 자동 폴링 제거
- Supabase Realtime(`postgres_changes`) 구독 제거
- 최초 접속 시 Supabase 저장 데이터만 로드
- 상단 **시트 동기화** 버튼을 누르면 길드원 + 출석/보스 시트를 즉시 동기화
- 우측 새로고침 아이콘은 Google Sheets를 호출하지 않고 Supabase 데이터만 다시 조회

Google Sheets 연동 자체는 제거하지 않았습니다. 출석 원본 시트 GID `400265627` 설정도 그대로 유지됩니다.
