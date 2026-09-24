ECLIPSE Google Forms 연동

1. Google Forms -> 응답 -> Google Sheets 연결
2. 연결된 Google Sheets -> 확장 프로그램 -> Apps Script
3. Code.gs 전체를 이 파일 내용으로 교체하고 저장(Ctrl+S)
4. 위 함수 선택 드롭다운에서 myFunction 선택
5. 실행(▶) -> Google 권한 승인
   myFunction은 installTrigger를 실행하여 onFormSubmit 트리거를 자동 생성합니다.
6. 트리거 메뉴(시계 아이콘)에서 onFormSubmit이 만들어졌는지 확인

중요:
- 함수 목록에 myFunction이 안 보이면 Code.gs를 저장한 뒤 페이지를 새로고침하세요.
- '함수 없음'이 계속 나오면 기존 프로젝트에 잘못 붙여넣은 것이므로 Code.gs의 기존 내용을 전부 삭제하고 다시 붙여넣으세요.
- API_URL과 TOKEN은 실제 Vercel 주소와 Vercel 환경변수 ECLIPSE_INTEGRATION_TOKEN 값으로 변경하세요.

폼 질문 제목은 정확히 다음과 같아야 합니다.
닉네임
직업
투력
메모
