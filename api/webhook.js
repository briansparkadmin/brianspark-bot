// Brianspark AI 客服系統 - Vercel Serverless 後端
const { createClient } = require('@supabase/supabase-js');
const { GoogleGenAI } = require('@google/genai');
const crypto = require('crypto');

// 初始化 Supabase 與 Gemini
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    return res.status(200).send('Brianspark AI Bot Server is running!');
  }

  try {
    const events = req.body.events;
    if (!events || events.length === 0) return res.status(200).send('OK');

    for (const event of events) {
      if (event.type === 'message' && event.message.type === 'text') {
        const userMessage = event.message.text;
        const lineUserId = event.source.userId;

        // 1. 檢查 Supabase 是否已有此客戶，沒有則自動建檔
        let { data: customer } = await supabase
          .from('customers')
          .select('*')
          .eq('line_user_id', lineUserId)
          .single();

        if (!customer) {
          const { data: newCust } = await supabase
            .from('customers')
            .insert([{ line_user_id: lineUserId, tags: ['新客戶'] }])
            .select()
            .single();
          customer = newCust;
        }

        // 2. 呼叫 Gemini AI 產生回覆
        const response = await ai.models.generateContent({
          model: 'gemini-2.5-flash',
          contents: userMessage,
          config: {
            systemInstruction: "你是一個專業、親切的企業級 AI 客服，負責協助解答顧客問題。"
          }
        });
        const aiReply = response.text || "您好，系統正在處理您的問題。";

        // 3. 記錄訊息至 Supabase
        await supabase.from('messages').insert([
          { customer_id: customer.id, sender_type: 'customer', content: userMessage },
          { customer_id: customer.id, sender_type: 'ai', content: aiReply }
        ]);

        // 4. 回傳訊息給 LINE (需設定 Channel Access Token)
        await fetch('https://api.line.me/v2/bot/message/reply', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${process.env.LINE_CHANNEL_ACCESS_TOKEN}`
          },
          body: JSON.stringify({
            replyToken: event.replyToken,
            messages: [{ type: 'text', text: aiReply }]
          })
        });
      }
    }

    return res.status(200).json({ status: 'success' });
  } catch (error) {
    console.error('Error:', error);
    return res.status(500).json({ error: error.message });
  }
};
