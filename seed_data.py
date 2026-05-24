import bcrypt
import os
from pymongo import MongoClient
from datetime import datetime, timezone, timedelta
from bson import ObjectId

MONGODB_URL = os.getenv("MONGODB_URL", "mongodb://localhost:27017")
client = MongoClient(MONGODB_URL)
db = client[os.getenv("DATABASE_NAME", "emotion_tracker_db")]

# 清除舊資料，確保測試環境乾淨
db.users.delete_many({})
db.conversations.delete_many({})
db.emotion_analyses.delete_many({})
db.emotion_trends.delete_many({})
print("🧹 舊資料已完全清除")

# 輔助函式：將密碼用 bcrypt 加密
def generate_hashed_password(password: str) -> str:
    return bcrypt.hashpw(password.encode('utf-8'), bcrypt.gensalt()).decode('utf-8')

# 設定這 5 個人的登入密碼
TEST_PASSWORD = "password123"
hashed_pwd = generate_hashed_password(TEST_PASSWORD)

# 假資料：5 人 × 7 天
USERS_DATA = [
    {
        "username": "小明",
        "email": "ming@test.com",
        "days": [
            { "emotions": {"Joy":40,"Sadness":30,"Anger":5,"Fear":20,"Anticipation":15,"Surprise":5,"Disgust":0,"Trust":50}, "dominant_emotions": ["Trust","Joy","Fear"], "risk_level": "none", "emotional_intensity": 1, "analysis_notes": "學業壓力下仍靠朋友支持撐過去", "stressor_tags": [{"tag":"schoolwork","reason":"期末報告壓力大，一直熬夜趕工"},{"tag":"future","reason":"對畢業後方向感到迷茫"}], "buffer_tags": [{"tag":"friend_support","reason":"朋友陪讀讓心情穩定"}], "joy_tags": [{"tag":"achievement","reason":"完成困難作業的成就感"}], "one_line_summary": "學業壓力大，靠朋友支持撐過去", "diary": "今天報告壓力很大，還好有朋友陪著一起讀書。" },
            { "emotions": {"Joy":20,"Sadness":65,"Anger":10,"Fear":15,"Anticipation":5,"Surprise":0,"Disgust":5,"Trust":10}, "dominant_emotions": ["Sadness","Anger","Joy"], "risk_level": "none", "emotional_intensity": 2, "analysis_notes": "人際摩擦讓這天情緒偏低", "stressor_tags": [{"tag":"relationships","reason":"和朋友發生誤解心情很沉"}], "buffer_tags": [{"tag":"rest","reason":"長覺稍微恢復"}], "joy_tags": [], "one_line_summary": "人際摩擦讓這天情緒偏低", "diary": "和朋友鬧誤解，心情很差，只想睡覺。" },
            { "emotions": {"Joy":60,"Sadness":10,"Anger":0,"Fear":10,"Anticipation":25,"Surprise":10,"Disgust":0,"Trust":65}, "dominant_emotions": ["Trust","Joy","Anticipation"], "risk_level": "none", "emotional_intensity": 1, "analysis_notes": "朋友陪伴讓這天充滿正能量", "stressor_tags": [{"tag":"time","reason":"行程太滿沒有喘息空間"}], "buffer_tags": [{"tag":"routine","reason":"維持作息讓情緒穩定"}], "joy_tags": [{"tag":"friend_time","reason":"和朋友聚餐心情變好"}], "one_line_summary": "忙碌但朋友陪伴讓心情愉快", "diary": "今天很忙，不過和朋友吃飯聊天，心情好多了。" },
            { "emotions": {"Joy":15,"Sadness":40,"Anger":20,"Fear":50,"Anticipation":5,"Surprise":0,"Disgust":10,"Trust":25}, "dominant_emotions": ["Fear","Sadness","Anger"], "risk_level": "low", "emotional_intensity": 2, "analysis_notes": "對未來不確定感引發強烈焦慮", "stressor_tags": [{"tag":"future","reason":"出路未定感到焦慮"},{"tag":"self_image","reason":"覺得自己表現不夠好"}], "buffer_tags": [{"tag":"none","reason":""}], "joy_tags": [], "one_line_summary": "對未來的不確定感讓情緒很低", "diary": "今天很焦慮，一直想不通以後要做什麼。" },
            { "emotions": {"Joy":45,"Sadness":20,"Anger":0,"Fear":10,"Anticipation":30,"Surprise":5,"Disgust":0,"Trust":55}, "dominant_emotions": ["Trust","Joy","Anticipation"], "risk_level": "none", "emotional_intensity": 1, "analysis_notes": "家人支持帶來溫暖與安定感", "stressor_tags": [{"tag":"health","reason":"身體不舒服影響心情"}], "buffer_tags": [{"tag":"family_support","reason":"家人的關心讓感覺被支持"}], "joy_tags": [{"tag":"gratitude","reason":"感謝有家人在身邊"}], "one_line_summary": "身體不適但家人給了很多溫暖", "diary": "身體不舒服，但媽媽煮湯給我喝，感覺好很多。" },
            { "emotions": {"Joy":55,"Sadness":15,"Anger":0,"Fear":5,"Anticipation":35,"Surprise":10,"Disgust":0,"Trust":70}, "dominant_emotions": ["Trust","Anticipation","Joy"], "risk_level": "none", "emotional_intensity": 1, "analysis_notes": "壓力解除後正向情緒明顯回升", "stressor_tags": [{"tag":"schoolwork","reason":"報告告一段落壓力減輕"}], "buffer_tags": [{"tag":"rest","reason":"好好休息讓能量恢復"}], "joy_tags": [{"tag":"relief","reason":"交出報告後如釋重負"}], "one_line_summary": "壓力解除後整個人輕鬆很多", "diary": "終於交出報告了！今天好好休息。" },
            { "emotions": {"Joy":70,"Sadness":5,"Anger":0,"Fear":0,"Anticipation":10,"Surprise":5,"Disgust":0,"Trust":75}, "dominant_emotions": ["Trust","Joy","Anticipation"], "risk_level": "none", "emotional_intensity": 1, "analysis_notes": "情緒高峰，充滿信任與喜悅", "stressor_tags": [], "buffer_tags": [{"tag":"friend_support","reason":"和朋友一起規劃接下來的事"}], "joy_tags": [{"tag":"achievement","reason":"完成重要里程碑"},{"tag":"friend_time","reason":"和好友度過愉快時光"}], "one_line_summary": "情緒最佳的一天，充滿活力", "diary": "今天超開心！和朋友出去玩，完全放鬆。" }
        ]
    },
    {
        "username": "小華",
        "email": "hua@test.com",
        "days": [
            { "emotions": {"Joy":30,"Sadness":50,"Anger":15,"Fear":30,"Anticipation":10,"Surprise":0,"Disgust":10,"Trust":20}, "dominant_emotions": ["Sadness","Fear","Anger"], "risk_level": "low", "emotional_intensity": 2, "analysis_notes": "家庭與金錢壓力同時湧現", "stressor_tags": [{"tag":"family","reason":"家裡有事讓心情很沉重"},{"tag":"money","reason":"這個月開銷超出預算"}], "buffer_tags": [{"tag":"rest","reason":"睡覺是唯一喘息時間"}], "joy_tags": [], "one_line_summary": "家庭與金錢雙重壓力", "diary": "家裡的事一直讓我分心，錢也不夠用，很崩潰。" },
            { "emotions": {"Joy":35,"Sadness":40,"Anger":5,"Fear":20,"Anticipation":20,"Surprise":5,"Disgust":5,"Trust":35}, "dominant_emotions": ["Sadness","Joy","Fear"], "risk_level": "none", "emotional_intensity": 1, "analysis_notes": "迷茫中找到一絲平靜", "stressor_tags": [{"tag":"future","reason":"不確定自己的方向在哪"}], "buffer_tags": [{"tag":"routine","reason":"維持日常讓心情不崩"}], "joy_tags": [{"tag":"rest","reason":"難得有時間休息"}], "one_line_summary": "迷茫感仍在，稍微找回平靜", "diary": "不知道以後要幹嘛，打今天至少有休息到。" },
            { "emotions": {"Joy":50,"Sadness":20,"Anger":0,"Fear":10,"Anticipation":40,"Surprise":15,"Disgust":0,"Trust":45}, "dominant_emotions": ["Anticipation","Joy","Trust"], "risk_level": "none", "emotional_intensity": 1, "analysis_notes": "合作帶來動力與成就感", "stressor_tags": [{"tag":"schoolwork","reason":"有個大報告要準備"}], "buffer_tags": [{"tag":"friend_support","reason":"室友陪我討論壓力小很多"}], "joy_tags": [{"tag":"achievement","reason":"報告大綱完成感覺很好"}], "one_line_summary": "和朋友合作讓這天充滿動力", "diary": "報告大綱弄完了，室友幫了我很多。" },
            { "emotions": {"Joy":25,"Sadness":55,"Anger":25,"Fear":20,"Anticipation":5,"Surprise":0,"Disgust":15,"Trust":15}, "dominant_emotions": ["Sadness","Anger","Disgust"], "risk_level": "low", "emotional_intensity": 2, "analysis_notes": "人際誤解引發自我懷疑", "stressor_tags": [{"tag":"relationships","reason":"被人誤解又不知怎麼解釋"},{"tag":"self_image","reason":"開始懷疑自己哪裡有問題"}], "buffer_tags": [{"tag":"none","reason":""}], "joy_tags": [], "one_line_summary": "人際誤解加自我懷疑，很難熬", "diary": "被誤解了，越想越難過，開始懷疑自己。" },
            { "emotions": {"Joy":40,"Sadness":25,"Anger":5,"Fear":15,"Anticipation":35,"Surprise":10,"Disgust":0,"Trust":50}, "dominant_emotions": ["Trust","Anticipation","Joy"], "risk_level": "none", "emotional_intensity": 1, "analysis_notes": "運動帶來情緒轉機", "stressor_tags": [{"tag":"time","reason":"時間不夠用，事情排不完"}], "buffer_tags": [{"tag":"exercise","reason":"去跑步讓頭腦清醒很多"}], "joy_tags": [{"tag":"relief","reason":"解決了一件懸著的事"}], "one_line_summary": "運動幫助找回能量，心情轉好", "diary": "去跑步了！腦袋清醒多了，情緒也好轉。" },
            { "emotions": {"Joy":60,"Sadness":15,"Anger":0,"Fear":5,"Anticipation":30,"Surprise":10,"Disgust":0,"Trust":60}, "dominant_emotions": ["Joy","Trust","Anticipation"], "risk_level": "none", "emotional_intensity": 1, "analysis_notes": "家人聯繫帶來溫暖力量", "stressor_tags": [{"tag":"time","reason":"還有事情沒完成但不焦慮了"}], "buffer_tags": [{"tag":"family_support","reason":"媽媽打電話來心情很好"}], "joy_tags": [{"tag":"family_time","reason":"和家人視訊感覺很溫暖"}], "one_line_summary": "家人的聯繫讓這天很有力量", "diary": "媽媽打電話來，聊了好久，心情超好。" },
            { "emotions": {"Joy":65,"Sadness":10,"Anger":0,"Fear":5,"Anticipation":25,"Surprise":10,"Disgust":0,"Trust":65}, "dominant_emotions": ["Trust","Joy","Anticipation"], "risk_level": "none", "emotional_intensity": 1, "analysis_notes": "放鬆後情緒全面回升", "stressor_tags": [], "buffer_tags": [{"tag":"friend_support","reason":"和朋友出去散心"}], "joy_tags": [{"tag":"friend_time","reason":"久違的放鬆心情大好"},{"tag":"gratitude","reason":"感謝身邊有這些朋友"}], "one_line_summary": "難得的放鬆，整個人都輕盈了", "diary": "今天和朋友出去玩，整個人放鬆了。" }
        ]
    },
    {
        "username": "雅婷",
        "email": "ting@test.com",
        "days": [
            { "emotions": {"Joy":55,"Sadness":15,"Anger":0,"Fear":10,"Anticipation":50,"Surprise":15,"Disgust":0,"Trust":60}, "dominant_emotions": ["Anticipation","Trust","Joy"], "risk_level": "none", "emotional_intensity": 1, "analysis_notes": "新工作前的期待與緊張並存", "stressor_tags": [{"tag":"future","reason":"新工作即將開始有點緊張"}], "buffer_tags": [{"tag":"routine","reason":"按部就班準備讓自己安心"}], "joy_tags": [{"tag":"achievement","reason":"準備工作都完成了很有成就感"}], "one_line_summary": "期待新工作，緊張中帶著興奮", "diary": "下週就要上班了，緊張但也很期待。" },
            { "emotions": {"Joy":70,"Sadness":5,"Anger":0,"Fear":5,"Anticipation":55,"Surprise":20,"Disgust":0,"Trust":65}, "dominant_emotions": ["Anticipation","Joy","Trust"], "risk_level": "none", "emotional_intensity": 1, "analysis_notes": "第一天上班順利，充滿期待", "stressor_tags": [{"tag":"time","reason":"新環境要適應，節奏比較快"}], "buffer_tags": [{"tag":"friend_support","reason":"同事很友善讓適應順利"}], "joy_tags": [{"tag":"achievement","reason":"第一天表現讓自己滿意"},{"tag":"friend_time","reason":"和新同事聊得很開心"}], "one_line_summary": "第一天上班順利，充滿活力", "diary": "第一天上班！同事都很好，感覺很不錯。" },
            { "emotions": {"Joy":50,"Sadness":20,"Anger":5,"Fear":20,"Anticipation":30,"Surprise":10,"Disgust":5,"Trust":45}, "dominant_emotions": ["Joy","Trust","Anticipation"], "risk_level": "none", "emotional_intensity": 1, "analysis_notes": "工作壓力漸增，仍維持正向狀態", "stressor_tags": [{"tag":"schoolwork","reason":"工作量比預期多，有點吃力"}], "buffer_tags": [{"tag":"routine","reason":"每天固定作息讓身心穩定"}], "joy_tags": [{"tag":"achievement","reason":"順利完成交辦任務"}], "one_line_summary": "工作量有點多，但完成任務感覺還不錯", "diary": "今天工作量蠻多的，但都完成了，有點累但有成就感。" },
            { "emotions": {"Joy":35,"Sadness":35,"Anger":10,"Fear":25,"Anticipation":15,"Surprise":5,"Disgust":5,"Trust":30}, "dominant_emotions": ["Sadness","Fear","Joy"], "risk_level": "none", "emotional_intensity": 1, "analysis_notes": "思鄉情緒與工作適應壓力交織", "stressor_tags": [{"tag":"family","reason":"很想家，但沒時間回去"},{"tag":"time","reason":"工作和生活還沒平衡好"}], "buffer_tags": [{"tag":"rest","reason":"週末好好補眠"}], "joy_tags": [{"tag":"gratitude","reason":"感謝有機會嘗試新生活"}], "one_line_summary": "思鄉加上忙碌，情緒有點複雜", "diary": "很想家，但工作還沒上軌道，沒辦法回去。" },
            { "emotions": {"Joy":60,"Sadness":15,"Anger":0,"Fear":10,"Anticipation":40,"Surprise":10,"Disgust":0,"Trust":60}, "dominant_emotions": ["Trust","Anticipation","Joy"], "risk_level": "none", "emotional_intensity": 1, "analysis_notes": "週末充電讓能量回升", "stressor_tags": [{"tag":"time","reason":"還有好多事想做但時間不夠"}], "buffer_tags": [{"tag":"rest","reason":"好好睡了一覺精神恢復"},{"tag":"exercise","reason":"去爬山讓心情很好"}], "joy_tags": [{"tag":"relief","reason":"暫時脫離工作壓力的輕鬆感"}], "one_line_summary": "週末好好充電，能量滿滿", "diary": "今天去爬山！完全充電了，明天可以繼續衝。" },
            { "emotions": {"Joy":65,"Sadness":10,"Anger":0,"Fear":5,"Anticipation":45,"Surprise":15,"Disgust":0,"Trust":70}, "dominant_emotions": ["Trust","Anticipation","Joy"], "risk_level": "none", "emotional_intensity": 1, "analysis_notes": "回到工作狀態，信心穩定", "stressor_tags": [{"tag":"schoolwork","reason":"有個重要簡報要準備"}], "buffer_tags": [{"tag":"routine","reason":"固定作息讓準備更有效率"}], "joy_tags": [{"tag":"achievement","reason":"簡報準備進度超前"}], "one_line_summary": "狀態回升，對工作充滿信心", "diary": "簡報準備得不錯，對自己有信心了。" },
            { "emotions": {"Joy":75,"Sadness":5,"Anger":0,"Fear":5,"Anticipation":35,"Surprise":10,"Disgust":0,"Trust":80}, "dominant_emotions": ["Trust","Joy","Anticipation"], "risk_level": "none", "emotional_intensity": 1, "analysis_notes": "簡報成功帶來高度成就感", "stressor_tags": [], "buffer_tags": [{"tag":"friend_support","reason":"同事給了很多鼓勵"}], "joy_tags": [{"tag":"achievement","reason":"簡報大成功，得到上司肯定"},{"tag":"friend_time","reason":"和同事慶祝心情超好"}], "one_line_summary": "簡報大成功！這週最棒的一天", "diary": "今天的簡報超成功！上司誇我，同事也一起慶祝。" }
        ]
    },
    {
        "username": "志豪",
        "email": "hao@test.com",
        "days": [
            { "emotions": {"Joy":20,"Sadness":60,"Anger":30,"Fear":25,"Anticipation":5,"Surprise":0,"Disgust":20,"Trust":10}, "dominant_emotions": ["Sadness","Anger","Fear"], "risk_level": "moderate", "emotional_intensity": 2, "analysis_notes": "長期壓力積累導致情緒臨界", "stressor_tags": [{"tag":"self_image","reason":"一直覺得自己做什麼都不夠好"},{"tag":"future","reason":"對未來完全沒有頭緒"}], "buffer_tags": [{"tag":"none","reason":""}], "joy_tags": [], "one_line_summary": "壓力積累，開始有些失控感", "diary": "最近一直覺得自己什麼都做不好，很煩。" },
            { "emotions": {"Joy":30,"Sadness":45,"Anger":15,"Fear":20,"Anticipation":15,"Surprise":5,"Disgust":10,"Trust":25}, "dominant_emotions": ["Sadness","Fear","Joy"], "risk_level": "none", "emotional_intensity": 1, "analysis_notes": "情緒稍微緩和，找到一點出口", "stressor_tags": [{"tag":"schoolwork","reason":"作業堆積如山不知從哪開始"}], "buffer_tags": [{"tag":"rest","reason":"昨晚睡得比較好今天好一點"}], "joy_tags": [{"tag":"relief","reason":"完成了一件拖很久的事"}], "one_line_summary": "好一點了，完成了一件拖很久的事", "diary": "今天終於把那個作業交了，鬆了一口氣。" },
            { "emotions": {"Joy":45,"Sadness":25,"Anger":5,"Fear":15,"Anticipation":30,"Surprise":10,"Disgust":5,"Trust":40}, "dominant_emotions": ["Joy","Anticipation","Trust"], "risk_level": "none", "emotional_intensity": 1, "analysis_notes": "與朋友互動帶來情緒好轉", "stressor_tags": [{"tag":"relationships","reason":"和某個朋友還有些疙瘩沒解決"}], "buffer_tags": [{"tag":"friend_support","reason":"其他朋友的支持讓我沒那麼孤單"}], "joy_tags": [{"tag":"friend_time","reason":"一起打球心情好很多"}], "one_line_summary": "打球讓心情好多了", "diary": "今天去打球，大家一起玩，忘記煩惱了。" },
            { "emotions": {"Joy":25,"Sadness":50,"Anger":20,"Fear":30,"Anticipation":10,"Surprise":0,"Disgust":15,"Trust":15}, "dominant_emotions": ["Sadness","Fear","Anger"], "risk_level": "low", "emotional_intensity": 2, "analysis_notes": "睡眠不足加重情緒負擔", "stressor_tags": [{"tag":"health","reason":"連續幾天睡眠很差"},{"tag":"self_image","reason":"對自己的狀態越來越不滿意"}], "buffer_tags": [{"tag":"none","reason":""}], "joy_tags": [], "one_line_summary": "睡不好加上自我否定，情緒很低", "diary": "又失眠了，白天整個人很差，什麼都不想做。" },
            { "emotions": {"Joy":50,"Sadness":20,"Anger":5,"Fear":10,"Anticipation":35,"Surprise":15,"Disgust":0,"Trust":50}, "dominant_emotions": ["Trust","Anticipation","Joy"], "risk_level": "none", "emotional_intensity": 1, "analysis_notes": "規律作息讓情緒逐漸回穩", "stressor_tags": [{"tag":"time","reason":"要趕的東西還很多"}], "buffer_tags": [{"tag":"routine","reason":"強迫自己早睡早起有改善"},{"tag":"exercise","reason":"去健身讓身心都好一點"}], "joy_tags": [{"tag":"achievement","reason":"今天的事情都按計畫完成"}], "one_line_summary": "作息調整後狀態明顯好轉", "diary": "強迫自己早睡，今天精神好很多，也去健身了。" },
            { "emotions": {"Joy":55,"Sadness":15,"Anger":0,"Fear":10,"Anticipation":30,"Surprise":10,"Disgust":0,"Trust":60}, "dominant_emotions": ["Trust","Joy","Anticipation"], "risk_level": "none", "emotional_intensity": 1, "analysis_notes": "穩定向好，信任感回升", "stressor_tags": [{"tag":"schoolwork","reason":"還有考試要準備"}], "buffer_tags": [{"tag":"friend_support","reason":"和室友一起讀書效率高"}], "joy_tags": [{"tag":"achievement","reason":"念書念得有進度"}], "one_line_summary": "和室友一起念書，狀態不錯", "diary": "和室友一起讀書，有說有笑，效率也高。" },
            { "emotions": {"Joy":65,"Sadness":10,"Anger":0,"Fear":5,"Anticipation":20,"Surprise":10,"Disgust":0,"Trust":70}, "dominant_emotions": ["Trust","Joy","Anticipation"], "risk_level": "none", "emotional_intensity": 1, "analysis_notes": "情緒持續回升，感到穩定", "stressor_tags": [], "buffer_tags": [{"tag":"rest","reason":"考完試好好休息"},{"tag":"friend_support","reason":"朋友約出去慶祝"}], "joy_tags": [{"tag":"relief","reason":"考試結束整個人放鬆"},{"tag":"friend_time","reason":"和朋友出去很開心"}], "one_line_summary": "考試結束，整個人放鬆下來了", "diary": "考完試！和朋友出去慶祝，這週終於結束了。" }
        ]
    },
    {
        "username": "佳穎",
        "email": "ying@test.com",
        "days": [
            { "emotions": {"Joy":50,"Sadness":20,"Anger":0,"Fear":15,"Anticipation":45,"Surprise":20,"Disgust":0,"Trust":55}, "dominant_emotions": ["Anticipation","Trust","Joy"], "risk_level": "none", "emotional_intensity": 1, "analysis_notes": "充滿期待地展開新計畫", "stressor_tags": [{"tag":"future","reason":"新計畫很多未知數有點不安"}], "buffer_tags": [{"tag":"routine","reason":"有計畫地推進讓自己安心"}], "joy_tags": [{"tag":"achievement","reason":"把計畫細節都整理好了"}], "one_line_summary": "展開新計畫，期待與不安並存", "diary": "開始新計畫了！有點緊張但很興奮。" },
            { "emotions": {"Joy":60,"Sadness":10,"Anger":0,"Fear":10,"Anticipation":50,"Surprise":15,"Disgust":0,"Trust":65}, "dominant_emotions": ["Anticipation","Trust","Joy"], "risk_level": "none", "emotional_intensity": 1, "analysis_notes": "計畫推進順利，信心大增", "stressor_tags": [{"tag":"time","reason":"同時進行太多事有點分身乏術"}], "buffer_tags": [{"tag":"routine","reason":"番茄鐘工作法幫助集中"}], "joy_tags": [{"tag":"achievement","reason":"今天的進度超出預期"}], "one_line_summary": "進度超前，對自己很滿意", "diary": "今天效率超高，進度都超前了！" },
            { "emotions": {"Joy":40,"Sadness":30,"Anger":10,"Fear":20,"Anticipation":25,"Surprise":5,"Disgust":5,"Trust":40}, "dominant_emotions": ["Joy","Trust","Sadness"], "risk_level": "none", "emotional_intensity": 1, "analysis_notes": "遇到瓶頸但仍保持平衡", "stressor_tags": [{"tag":"schoolwork","reason":"遇到技術問題卡關好久"}], "buffer_tags": [{"tag":"friend_support","reason":"請教朋友後解決了問題"}], "joy_tags": [{"tag":"relief","reason":"卡關的問題終於解決了"}], "one_line_summary": "遇到瓶頸，靠朋友幫助突破", "diary": "卡了好久的問題被朋友幫忙解決了，感謝！" },
            { "emotions": {"Joy":35,"Sadness":40,"Anger":5,"Fear":25,"Anticipation":20,"Surprise":5,"Disgust":10,"Trust":30}, "dominant_emotions": ["Sadness","Fear","Joy"], "risk_level": "none", "emotional_intensity": 1, "analysis_notes": "疲勞累積影響情緒穩定度", "stressor_tags": [{"tag":"health","reason":"連續工作太累身體發出警訊"},{"tag":"time","reason":"事情做不完開始焦慮"}], "buffer_tags": [{"tag":"rest","reason":"強迫自己休息半天"}], "joy_tags": [{"tag":"gratitude","reason":"感謝自己還撐得住"}], "one_line_summary": "身體開始抗議，逼自己休息", "diary": "太累了，強迫自己下午不工作，好好休息。" },
            { "emotions": {"Joy":55,"Sadness":15,"Anger":0,"Fear":10,"Anticipation":40,"Surprise":10,"Disgust":0,"Trust":60}, "dominant_emotions": ["Trust","Anticipation","Joy"], "risk_level": "none", "emotional_intensity": 1, "analysis_notes": "休息後重新出發，狀態回穩", "stressor_tags": [{"tag":"time","reason":"進度有點落後需要追"}], "buffer_tags": [{"tag":"exercise","reason":"早上跑步讓精神很好"}], "joy_tags": [{"tag":"achievement","reason":"把落後的進度追回來了"}], "one_line_summary": "重新出發，把落後的進度追回來", "diary": "早上去跑步，精神超好，把進度都追回來了。" },
            { "emotions": {"Joy":65,"Sadness":10,"Anger":0,"Fear":5,"Anticipation":45,"Surprise":15,"Disgust":0,"Trust":70}, "dominant_emotions": ["Trust","Anticipation","Joy"], "risk_level": "none", "emotional_intensity": 1, "analysis_notes": "接近完成目標，充滿動力", "stressor_tags": [{"tag":"future","reason":"快完成了反而開始緊張成果"}], "buffer_tags": [{"tag":"routine","reason":"維持穩定節奏衝刺"}], "joy_tags": [{"tag":"achievement","reason":"幾乎要完成計畫了"}], "one_line_summary": "衝刺階段，距離目標只差一步", "diary": "再一步就完成了！緊張但更興奮。" },
            { "emotions": {"Joy":80,"Sadness":5,"Anger":0,"Fear":0,"Anticipation":20,"Surprise":15,"Disgust":0,"Trust":80}, "dominant_emotions": ["Joy","Trust","Surprise"], "risk_level": "none", "emotional_intensity": 1, "analysis_notes": "計畫完成帶來極大成就感與喜悅", "stressor_tags": [], "buffer_tags": [{"tag":"friend_support","reason":"朋友都來幫忙慶祝"}], "joy_tags": [{"tag":"achievement","reason":"計畫完成！所有努力都值得了"},{"tag":"friend_time","reason":"和朋友慶祝心情超好"}], "one_line_summary": "計畫大功告成！這週最棒的結局", "diary": "完成了！一切努力都值得，今天超級開心！" }
        ]
    }
]

# 基準日期設定為 2026-05-15
base_date = datetime(2026, 5, 15, tzinfo=timezone.utc)

for u in USERS_DATA:
    user_doc = {
        "username": u["username"],
        "email": u["email"],
        "hashed_password": hashed_pwd,
        "created_at": datetime.now(timezone.utc)
    }
    uid = db.users.insert_one(user_doc).inserted_id

    for i, day in enumerate(u["days"]):
        ts = base_date + timedelta(days=i)
        date_str = ts.strftime("%Y-%m-%d")

        conv = {
            "userId": uid,
            "content": day["diary"],
            "ai_response": "謝謝你的分享。",
            "timestamp": ts
        }
        cid = db.conversations.insert_one(conv).inserted_id

        analysis = {
            "userId": uid,
            "conversationId": cid,
            "scores": {k: v/100 for k, v in day["emotions"].items()},
            "emotions_raw": day["emotions"],
            "dominant_emotions": day["dominant_emotions"],
            "risk_level": day["risk_level"],
            "emotional_intensity": day["emotional_intensity"],
            "analysis_notes": day["analysis_notes"],
            "stressor_tags": day["stressor_tags"],
            "buffer_tags": day["buffer_tags"],
            "joy_tags": day["joy_tags"],
            "one_line_summary": day["one_line_summary"],
            "summary": day["analysis_notes"],
            "analyzed_at": ts
        }
        db.emotion_analyses.insert_one(analysis)

        existing = db.emotion_trends.find_one({"userId": uid, "date_label": date_str})
        if not existing:
            db.emotion_trends.insert_one({
                "userId": uid,
                "date_label": date_str,
                "average_scores": {k: v/100 for k, v in day["emotions"].items()},
                "count": 1,
                "updated_at": ts
            })

    print(f"✅ {u['username']} — 7 天歷史與趨勢資料注入成功（Email: {u['email']}）")

print("\n🚀 5 位使用者生態系建立完成！")
client.close()
