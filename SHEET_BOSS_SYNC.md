# 보스 참여 기록 - Google Sheets 직접 연동

이 긴급 버전은 보스 참여 기록을 Supabase에 저장하지 않고 Google Sheets에서 직접 읽습니다.

현재 사용 시트:
- Spreadsheet ID: `10TUvN2-5otNh22h8ABDT3bzek6anbUxeJhjodvBfQzE`
- GID: `400265627`

시트 열:
- A: 참여 닉네임
- B: 참여 시간
- C: 보스명
- D: 총인원
- E: 참여 점수
- F: 젠 시간

Google Sheets의 해당 탭은 Vercel 서버에서 CSV로 읽을 수 있어야 합니다. `파일 → 공유 → 웹에 게시`에서 해당 탭을 CSV로 게시하는 방식이 가장 간단합니다.

사이트 오른쪽 위 ↻ 버튼을 누르면 최신 시트를 다시 읽습니다. 자동 폴링이나 Supabase Realtime은 사용하지 않습니다.
