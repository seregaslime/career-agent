# Deployment: Render + Neon + Cloudflare Pages

## Порядок выпуска

PR → Repository checks → merge в main → проверки merge-коммита → Deploy production.
Job deploy получает тот же github.sha, что проверен CI. Render получает commitId; скрипт ждёт live и сверяет commit. Затем проверяется /api/ready, собирается frontend с публичным API URL и публикуется в Cloudflare Pages.

Деплой работает только на push в main, после успешного CI, и только при DEPLOY_ENABLED=true. PR и ручной workflow_dispatch не выпускают production. Автодеплой Render должен быть выключен, чтобы не обходить CI. Сериализация production job запрещает одновременные выпуски; текущий выпуск не отменяется.

## GitHub Settings → Environments → production

Создать environment production и разрешить deploy только из main.

Secrets:
- RENDER_API_KEY — ключ Render; никогда не передавать в frontend.
- CLOUDFLARE_API_TOKEN — токен Account / Cloudflare Pages / Edit для нужного аккаунта.

Variables:
- RENDER_SERVICE_ID — ID backend-сервиса.
- API_BASE_URL — публичный HTTPS URL backend без /api.
- CLOUDFLARE_ACCOUNT_ID — ID аккаунта Cloudflare.
- CLOUDFLARE_PAGES_PROJECT — имя Pages Direct Upload проекта с production branch main.

Repository variable DEPLOY_ENABLED=true включить только после заполнения всех настроек и успешной проверки первого деплоя. Пока false / отсутствует, deploy job пропускается; CI продолжает работать.

## Backend Render Free

Git repo: https://github.com/seregaslime/career-agent, branch main, runtime Python, plan free, region Frankfurt.
Build: `cd backend && uv sync --frozen --no-dev`.
Start: `sh backend/start.sh`.
PYTHON_VERSION=3.12.13. DATABASE_URL — прямой TLS connection string Neon с драйвером postgresql+psycopg. CORS_ORIGINS — JSON-массив точных frontend origins. Healthcheck — /api/ready.

На Free нет отдельной pre-deploy команды: миграции выполняются перед запуском API. Используется один экземпляр. Будущие миграции должны оставаться совместимыми со старой версией до переключения трафика; схема БД не откатывается автоматически.

## Cloudflare

Создать аккаунт самостоятельно, затем Pages Direct Upload проект. Домен покупать не нужно — используется pages.dev. Токен вводить в GitHub Secrets, не в чат. Не включать второй независимый Git-autodeploy поверх этого workflow.

## Проверка и повтор выпуска

Проверить: /api/health → 200; /api/ready → 200; frontend открывается и показывает API и PostgreSQL доступными. Проверить прямое открытие /chat (SPA fallback). Пока эти проверки не пройдены, первый деплой не считается завершённым.

После исправления временного сбоя повторно запустить jobs неудачного push workflow на main. workflow_dispatch предназначен только для CI. Любой rollback приложения не означает rollback БД; сначала проверить совместимость миграций.

## Ссылки

- [Render deploy API](https://api-docs.render.com/reference/create-deploy)
- [Cloudflare CI direct upload](https://developers.cloudflare.com/pages/how-to/use-direct-upload-with-continuous-integration/)
