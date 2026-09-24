# ECLIPSE Guild Manager — Vercel 배포용

이 폴더는 Vercel에서 Next.js 프로젝트로 바로 배포할 수 있도록 정리된 버전입니다.

## 1. Supabase

Supabase 프로젝트를 만든 뒤 `supabase/schema.sql` 전체를 SQL Editor에서 한 번 실행합니다.

## 2. Vercel Environment Variables

Vercel 프로젝트의 Settings → Environment Variables에 아래 값을 넣습니다.

```env
NEXT_PUBLIC_SUPABASE_URL=https://YOUR_PROJECT.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=YOUR_ANON_KEY
NEXT_PUBLIC_ADMIN_PASSWORD=원하는_관리자_비밀번호
SUPABASE_SERVICE_ROLE_KEY=YOUR_SERVICE_ROLE_KEY
ECLIPSE_INTEGRATION_TOKEN=긴_랜덤_문자열
```

선택적으로 Google Sheet를 바꾸려면:

```env
GOOGLE_SHEET_ID=스프레드시트_ID
GOOGLE_SHEET_GID=시트_GID
```

`SUPABASE_SERVICE_ROLE_KEY`와 `ECLIPSE_INTEGRATION_TOKEN`에는 `NEXT_PUBLIC_`을 절대 붙이지 않습니다.

## 3. Google Sheet

기본 ECLIPSE Sheet를 그대로 사용할 경우 별도 설정 없이 기본 ID/GID가 사용됩니다.
다른 Sheet를 쓸 경우 `GOOGLE_SHEET_ID`, `GOOGLE_SHEET_GID`를 설정합니다.

Vercel 서버가 CSV를 읽을 수 있도록 해당 Sheet를 웹에 게시하거나 서버에서 읽을 수 있는 공개 상태로 설정해야 합니다.

필수 헤더:
- 닉네임 / 이름 / 게임닉네임 / 캐릭터명 중 하나
- 투력 / 전투력 / 전투력(투력) 중 하나

선택 헤더:
- 직업 / 클래스
- 메모 / 비고

## 4. Vercel 배포

GitHub에 이 폴더 전체를 올리고 Vercel에서 해당 Repository를 Import합니다.

Framework Preset: Next.js
Build Command: `npm run build`

별도 Start Command는 설정하지 않아도 됩니다.

## 5. Discord 봇

`integrations/discord-bot/.env.example`을 참고해 Discord 봇의 `ECLIPSE_API_URL`에 배포된 Vercel 주소를 넣고,
웹사이트와 동일한 `ECLIPSE_INTEGRATION_TOKEN`을 사용합니다.

## 변경 사항

- 관리자 비밀번호를 코드에 고정하지 않고 `NEXT_PUBLIC_ADMIN_PASSWORD` 환경변수에서 읽도록 변경
- Google Sheet 동기화와 Supabase Realtime 이벤트가 서로 반복 호출되는 루프를 방지
- 초기 로드/수동 새로고침/60초 주기 갱신에서만 Sheet 동기화
- `.gitignore` 추가로 `.env.local` 등의 비밀값 커밋 방지
- Vercel용 `vercel.json` 추가
