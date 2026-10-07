# 하루 할 일 달력

달력에서 날짜를 골라 그날의 할 일을 적고, 매일 달성률을 %로 보는 웹앱입니다.
구글 로그인으로 휴대폰과 PC에서 같은 목록이 실시간으로 동기화되고, 휴대폰에서는 홈 화면에 추가해 앱처럼 쓸 수 있어요.

## 설정

1. `firebase-config.js`에 Firebase 웹 앱 설정값을 넣습니다.
2. Firebase 콘솔 > Firestore Database > 규칙 탭에 `firestore.rules` 내용을 붙여 넣고 게시합니다.
3. Firebase 콘솔 > Authentication > 설정 > 승인된 도메인에 GitHub Pages 주소(`<아이디>.github.io`)를 추가합니다.
4. GitHub 저장소 Settings > Pages에서 `main` 브랜치의 `/ (root)`를 배포 소스로 고릅니다.

## 파일

- `index.html`, `style.css`, `app.js`: 화면과 동작
- `firebase-config.js`: Firebase 연결 정보
- `firestore.rules`: 각자 자기 데이터만 읽고 쓰게 하는 보안 규칙
- `manifest.webmanifest`, `sw.js`, `icon*`: 홈 화면 설치와 오프라인 실행
