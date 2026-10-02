# 사용량 초과 방지 수정사항

이번 수정본은 Supabase의 `exceed_egress_quota`, `exceed_realtime_message_count_quota` 재발 가능성을 낮추기 위해 다음을 변경했습니다.

- Google Sheets 보스/출석 3~5초 자동 폴링 제거
- Google Sheets 길드원 30초 자동 폴링 제거
- Supabase Realtime(`postgres_changes`) 구독 제거
- 최초 접속 시 Supabase 저장 데이터만 로드
- 상단 **시트 동기화** 버튼을 누르면 길드원 + 출석/보스 시트를 즉시 동기화
- 우측 새로고침 아이콘은 Google Sheets를 호출하지 않고 Supabase 데이터만 다시 조회

Google Sheets 연동 자체는 제거하지 않았습니다. 출석 원본 시트 GID `400265627` 설정도 그대로 유지됩니다.

## 긴급 members 백업 모드

`public/data/members.json`에 Supabase에서 백업한 `members` 42건을 포함했습니다.
앱 최초 로딩은 Supabase를 조회하지 않고 이 JSON을 읽습니다. 따라서 Supabase가 quota 제한 상태여도
길드원 목록/메모/사다리 화면을 사용할 수 있습니다.

- 브라우저에서 길드원 추가/수정/삭제/메모 수정은 `localStorage`에 저장됩니다.
- 이 로컬 변경은 다른 기기/브라우저와 공유되지 않습니다.
- 보스 기록/분배금/관리자 메모 등 다른 기능의 저장은 기존 Supabase를 사용하므로 Supabase 제한이 풀리기 전에는 정상 저장되지 않을 수 있습니다.
- 원본 `public/data/members.json`은 초기 백업 데이터이므로 삭제하지 마세요.
