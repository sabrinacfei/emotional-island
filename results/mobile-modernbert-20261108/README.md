# iPhone 本機 ModernBERT 部署紀錄

日期：2026-11-09（台灣時間）。

## 本次變更

- 沿用已訓練的 ModernBERT＋LoRA，匯出時合併 LoRA，再轉為 FP16 Core ML；沒有重新訓練分類器。
- iPhone 使用原生 Swift tokenizer 與 Core ML 執行分類；每段最多 128 個輸入 tokens，相鄰段重疊 32 個內容 tokens，按涵蓋次數補正聚合權重。
- 保留每段與全文的八類 Softmax 分布；整數百分比僅供呈現，總和為 100。
- 分類前卸載 Qwen，分類結束釋放 Core ML 權重，再按需載入 Qwen。共用推論互斥控制，避免兩個模型同時推論。
- Qwen 直接取得日記原文，保留原文已提供的姓名、稱呼、日期與人物關係。舊版未使用的匿名摘要流程已移除；模型不得猜測未知身分。
- Render 新增接收手機分類結果的驗證端點，核對定稿、內容指紋、版本、分段與聚合一致性；此端點不執行神經網路、不呼叫 Hugging Face。
- App 同步失敗時保留已完成的本機結果供重試。

## 已完成驗證

- 45 項 Python 測試：`python-tests.txt`。
- 28 項 JavaScript 測試：`javascript-tests.txt`；TypeScript noEmit 檢查通過。
- 模型轉換比較：`conversion-parity.json`，八個合成片段的最大絕對分數差約 0.00308，最高分類均一致；這不是新的準確率或 F1 評估。
- Mac Swift 原生檢查：`native-core-check.json`，不可將其中時間視為手機效能。
- iPhone 16 Pro／iOS 26.6.2 原生檢查：`iphone-native-check.json`，214 組 tokenizer 案例一致，長文輸出與對照值差異低於 0.006。
- 這次 iPhone 測試中的 29-token 單段樣例約 2.99 秒（含首次模型載入）；260-token 三段樣例約 0.176 秒（已有系統快取）。僅為兩個合成樣例，不能當作平均或所有手機的速度。

## 備份與部署

- 更新前 GitHub 備份分支：`backup/before-phone-modernbert-20261108`，commit `29239d2`。
- 新接收端後端 commit：`bc9bda3`，Render API 已確認上線且需要登入。
- 手機分類與 Qwen 原文處理原始碼 commit：`9d9182d`；後續驗收修正以最新 Git log 為準。
- 原始訓練權重與本次編譯模型保留在電腦；GitHub 保存來源碼、manifest、tokenizer 與重建工具，不包含大型模型或私人驗收帳號。
- App 以原地更新方式安裝，已確認原本 Qwen GGUF 模型檔保留。

## 實作範圍

目前為 iOS 實作。帳號、定稿與日記／分析同步仍使用 Render 與 MongoDB，不能稱整套 App 完全離線，也不代表姓名與日記只存手機。保留舊雲端分類 API 供舊版相容；新版手機正式分類使用本機引擎。

伺服器記錄來源為 `client_reported_native_classifier`，代表客戶端提交的原生分類紀錄；伺服器簽章可綁定內容與結果，不是手機硬體遠端證明。FP16 版本尚未重跑完整測試集，也尚未驗收所有 iPhone 或 Android 裝置。

App 完整流程真機驗收已通過，見 `iphone-app-acceptance.json` 與 `iphone-classification-feedback.png`。驗證登入、日曆、既有定稿、手機 Core ML 分類、Qwen 語境／回饋／成因、Render 同步及八情緒圖表；這次草稿由 API 放入合成資料，沒有重測草稿生成。單一合成案例通過不代表所有文字、機型都保證成功。

驗收過程曾遇到 Qwen 後續輸出未通過檢查，當時日記與分類資料仍保留、沒有冒充完成；已補上未完成階段提示並通過重試。格式或證據檢查仍會拒絕不合格輸出。App 根層亦補齊手勢初始化；原本頁籤版面保留。配置依據：[Gesture Handler 2.x 官方安裝文件](https://docs.swmansion.com/react-native-gesture-handler/docs/2.x/fundamentals/installation/)。

完整 App 案例的三段分類約 1.46 秒，支持回饋生成約 14.63 秒／134 個輸出 token；後者僅計支持回饋那次生成，不含先前的語境與後續成因生成，因此不能當作整條分析流程時間。
