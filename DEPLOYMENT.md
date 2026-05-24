# Emotional Island 部署與手機通知

## 專案結構

- `main.py`: FastAPI API、MongoDB、通知與每日統整排程
- `emotion_pipeline.py`: 神經網路加 LLM 情緒分析流程
- `predict_sentence_json.py`: 神經網路推論腳本
- `EmotionApp2/`: Expo 手機 App
- `render.yaml` / `railway.json`: 後端雲端部署設定
- `.env.example`: 環境變數範本，不要把真正密碼或金鑰上傳 GitHub

`plutchik_human_poslog_data42_model17/model_state_dict.pt` 約 888MB，超過 GitHub 一般檔案限制，已由 `.gitignore` 排除。正式上線若要啟用神經網路，請將模型放到 Git LFS、Hugging Face 或雲端儲存，於建置時下載後設定 `PLUTCHIK_MODEL_DIR`。

## MongoDB Atlas

1. 在 MongoDB Atlas 建立 cluster、database user 與 network access。
2. 取得 Python connection string。
3. 在 Render 或 Railway 設定：

```env
MONGODB_URL=mongodb+srv://<username>:<password>@<cluster>/emotion_tracker_db?retryWrites=true&w=majority
DATABASE_NAME=emotion_tracker_db
JWT_SECRET=<long-random-secret>
OPENAI_API_KEY=<openai-api-key>
CORS_ORIGINS=*
```

不要把以上真實值寫進 `.env.example` 或 GitHub。

## Render / Railway 後端

Render 可直接使用 repository 中的 `render.yaml`，Railway 使用 `railway.json`。部署成功後檢查：

```bash
curl https://<your-api-domain>/health
```

應收到：

```json
{"ok":true,"service":"emotional-island-api"}
```

重要：App 關閉後的晚上整理與推播，依靠後端持續執行 `daily_scheduler_loop`。Render 免費服務可能休眠，因此本專案另外提供免費 GitHub Actions 喚醒方式。

## 免費排程喚醒 Render

不購買 Render 方案時，使用 `.github/workflows/wake-daily-diary.yml` 呼叫受密鑰保護的 `/tasks/daily-diary/run`。它每個整點喚醒服務，檢查上一小時是否完全沒有小日記並發送提醒；在台灣時間 18:33 至隔日 02:03 間另外每 10 分鐘觸發，涵蓋 App 可選的 19:00 至 23:59 整理時間與最長 120 分鐘修改期限。

1. 自行產生一段長而隨機的密鑰，例如密碼管理器產生的隨機字串。
2. 在 Render 的 `emotional-island-api` 服務打開 `Environment`，新增：

```env
CRON_SECRET=<your-long-random-secret>
```

3. 到 GitHub repository 的 `Settings > Secrets and variables > Actions > New repository secret`，新增：

```text
Name: DAILY_DIARY_CRON_SECRET
Secret: 與 Render 的 CRON_SECRET 完全相同的值
```

4. 重新部署 Render，使新版 `/tasks/daily-diary/run` 上線。
5. 到 GitHub `Actions > Wake daily diary scheduler > Run workflow` 手動測試一次。

成功時 Actions log 會收到包含 `ok: true` 的 JSON。這是零額外付費的展示方案，但 GitHub 官方說明 scheduled workflow 在高負載時可能延遲，所以自動統整可能比設定時間晚幾分鐘，不適合需要精確到分鐘的正式醫療或高風險服務。

## App 連接雲端 API

`EmotionApp2/app.json` 現在使用部署網址作為預設 API。建立不同環境的 App 時，也可指定：

```bash
EXPO_PUBLIC_API_URL=https://<your-api-domain> npx eas build --profile preview --platform ios
```

App 名稱為 `Emotional Island`，iOS bundle identifier 為 `com.sabrinacfei.emotionalisland`。

## iPhone 推播通知測試

1. 不要只依賴 Expo Go；建立並安裝 EAS `preview` 或 `development` build。
2. 第一次開啟 App、登入帳號後，允許 iPhone 通知權限。
3. 到 App 的「我的 > 設定 > 手機通知 > 傳送測試」。
4. App 會先把 Expo push token 儲存到目前登入帳號，再由後端即時送一封測試通知。
5. 若測試失敗，App 會顯示後端收到的 Expo 錯誤；確認新後端已重新部署後再測一次。

Expo 官方說明：

- [Push notifications setup](https://docs.expo.dev/push-notifications/push-notifications-setup/)
- [Notifications API](https://docs.expo.dev/versions/latest/sdk/notifications/)

## GitHub 前確認

```bash
git status --short
python3 -m py_compile main.py emotion_pipeline.py seed_data.py predict_sentence_json.py Initdata.py
cd EmotionApp2
npx tsc --noEmit
```

請確認 `git status` 沒有包含 `.env`、API key、MongoDB 密碼或 `model_state_dict.pt`。
