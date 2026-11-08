# iPhone 本機 ModernBERT

此版本把現有 ModernBERT＋LoRA 的分類工作移到 iPhone Core ML，Qwen 的量化模型與提示維持既有版本。這不是新的分類訓練。

## 執行分工

- iPhone：NFC／byte-level BPE tokenizer、128 輸入 token 視窗、相鄰 32 內容 token 重疊、Core ML 八類分布、涵蓋次數權重聚合、Qwen 草稿與回饋。
- Render：登入、原始片段／草稿／定稿、接收手機分類資料、校驗與簽發結果紀錄、保存分析與趨勢。
- `/mobile/emotions/on-device` 不執行模型，不呼叫 Hugging Face。它檢查使用者定稿、內容指紋、模型版本、分段涵蓋、分數與聚合一致性。
- 舊 `/mobile/emotions` 保留給舊 App，相容既有雲端分類流程。
- 分類 trace 為 `client_reported_native_classifier`。伺服器簽章綁定提交資料，**不是手機硬體執行的遠端證明**。

一般每日流程為：Qwen 草稿、使用者確認、卸載 Qwen、Core ML 分類、釋放分類權重、重新載入 Qwen 產生回饋、同步結果。兩個推論工作共用互斥控制，避免同時執行。

目前實作為 iOS。Android 尚未新增分類引擎。分類和文字生成在手機執行，帳號、定稿與同步仍使用網路，不能稱整套 App 完全離線。

本機 Qwen 直接接收原始日記，沒有先移除姓名、日期或替換人物稱呼。草稿、語境、成因與支持回饋可保留原文已提供的姓名，不猜測未知身分；已移除未使用的舊版匿名摘要回傳流程。長文超過 Qwen 上下文時仍需分段整理，摘要可能省略細節，不保證逐字保留所有內容。日記與分析目前仍同步 Render／MongoDB，這項修改不代表資料只存手機。

## 模型與資源

沿用訓練好的 encoder、LoRA、masked mean pooling、LayerNorm 與 Linear 分類頭。匯出時將 LoRA 合併進權重，使用固定 `(1,128)` 的 int32 token IDs／attention mask，補齊位置不參與 pooling 與聚合。Core ML 權重採 FP16，因此允許有限數值差異，需另行確認行動版本的完整測試集成績。

固定模型資訊在 `modernbert_phone_manifest.json` 與 App 的 `src/onDevice/modernbert/model.ts`。原生 bundle 內的 manifest 另包含編譯模型每個檔案的 SHA-256。模型約 299 MB，隨原生 App 打包；Qwen 約 2.65 GB 檔案則繼續保存在原 App models 目錄，更新 App 不需刪除它。

大型權重、編譯模型、私人驗收帳號與原始測試日誌不放進 Git。原始訓練 adapter、分類頭與基底權重需另外保留；不可用只有來源碼的 Git 備份取代模型檔備份。

## 重建模型

需要 Mac、完整 Xcode、Python 3.12 及相符版本的 torch／transformers／peft／coremltools。先以既有的 `prepare_modernbert.py` 準備固定 revision 的基底與訓練 adapter 快取。`MODERNBERT_ADAPTER_DIR` 應指向含 `tokenizer.json`、`adapter_model.safetensors`、`provenance.json` 及 `Sample_data/plutchik_classifier_head.pt` 的目錄。

在後端／整合目錄執行：

```sh
python mobile_model_tools/export_coreml.py
xcrun coremlcompiler compile ../.mobile_modernbert_work_20261108/ModernBERT.mlpackage EmotionApp2/modules/on-device-diagnostics/ios/Assets
python mobile_model_tools/prepare_assets.py
```

若使用 Git 根目錄直接作為整合目錄，輸出工作目錄位於該根目錄的 `.mobile_modernbert_work_20261108`，編譯指令請相應使用該路徑。匯出工具先核對 LoRA 合併、固定補齊與原模型結果，再檢查 Core ML 真實推論。模型／manifest 變更時，後端和 App 的版本指紋需一併更新。

在 App 目錄執行 `pod install --project-directory=ios` 後建立原生 Release。模型需打包進 `ModernBERTAssets.bundle`；Expo Go 無法載入這個原生模組。建議保留至少 5–10 GB Mac 可用空間供轉換與 Xcode 編譯。

## 本次證據與界線

`results/mobile-modernbert-20261108` 保存模型轉換比較、Swift tokenizer／Core ML 檢查，以及後端契約與 App 驗收結果。Mac 的 Core ML 時間不能當成 iPhone 的速度；API 合成格式探針也不能當成手機執行證據。手機結果以實際 Release App 的原生生成、分類 trace 與保存資料為準。

若雲端尚未部署新接收端，App 仍保存真實本機分析並標示同步待完成，重試時沿用已保存的結果，不重新編造分類或回饋。
