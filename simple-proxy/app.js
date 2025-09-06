const express = require('express');
const fetch = require('node-fetch');
const app = express();

// 添加body parser中间件
app.use(express.json());

// 健康检查
app.get('/health', (req, res) => {
  res.json({ status: 'ok', message: 'Dify-LibreChat Proxy' });
});

// 根路径
app.get('/', (req, res) => {
  res.json({ 
    status: 'ok', 
    message: 'Dify-LibreChat Proxy Server',
    target: 'https://sti485grxs9qmgl0.ai-plugin.io',
    endpoints: ['/v1/models', '/v1/chat/completions']
  });
});

// 模型列表端点 - 返回应用ID作为模型
app.get('/v1/models', (req, res) => {
  console.log('Models endpoint requested');
  res.json({
    "object": "list",
    "data": [
      {
        "id": "o946LsohQnWlnIP0",
        "object": "model",
        "created": Math.floor(Date.now() / 1000),
        "owned_by": "dify"
      }
    ]
  });
});

// 自定义处理聊天完成请求
app.post('/v1/chat/completions', async (req, res) => {
  try {
    console.log('=== Chat Completion Request ===');
    console.log('Headers:', JSON.stringify(req.headers, null, 2));
    console.log('Body:', JSON.stringify(req.body, null, 2));
    
    // 提取用户消息并转换为Dify原生格式
    const { messages = [] } = req.body;
    
    // 获取最后一条用户消息
    const userMessages = messages.filter(msg => msg.role === 'user');
    const lastUserMessage = userMessages[userMessages.length - 1];
    
    // 处理不同的content格式
    let query = '';
    if (lastUserMessage?.content) {
      if (typeof lastUserMessage.content === 'string') {
        query = lastUserMessage.content;
      } else if (Array.isArray(lastUserMessage.content)) {
        // 处理数组格式: [{"type": "text", "text": "..."}]
        const textContent = lastUserMessage.content.find(item => item.type === 'text');
        query = textContent?.text || '';
      }
    }
    
    // 如果没有提取到内容，使用默认
    if (!query.trim()) {
      query = '请介绍一下你自己';
    }
    
    // 转换为Dify原生API格式 - 强制使用blocking模式避免SSE流式响应
    const difyRequestBody = {
      inputs: {},
      query: query.trim(),
      response_mode: 'blocking', // 强制使用blocking模式获取完整JSON响应
      user: req.headers['x-user-id'] || 'librechat-user',
      conversation_id: '',
      auto_generate_name: false
    };
    
    console.log('Extracted query:', query);
    console.log('Sending to Dify native API:', JSON.stringify(difyRequestBody, null, 2));
    
    const response = await fetch('https://api.dify.ai/v1/chat-messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': req.headers.authorization || '',
        'User-Agent': 'DifyLibreChatProxy/1.0'
      },
      body: JSON.stringify(difyRequestBody)
    });
    
    console.log('=== Dify Response ===');
    console.log('Status:', response.status);
    console.log('Headers:', Object.fromEntries(response.headers));
    
    // 获取响应文本进行调试
    const responseText = await response.text();
    console.log('=== Raw Dify Response ===');
    console.log('Status:', response.status);
    console.log('Headers:', Object.fromEntries(response.headers));
    console.log('Raw Body:', responseText.substring(0, 500) + (responseText.length > 500 ? '...' : ''));
    
    if (!response.ok) {
      console.error('=== Dify Error Details ===');
      console.error('Status:', response.status);
      console.error('StatusText:', response.statusText);
      console.error('Full Body:', responseText);
      
      return res.status(response.status).json({
        error: {
          message: `Dify API error: ${response.status} ${response.statusText}`,
          type: 'dify_error',
          details: responseText,
          status: response.status
        }
      });
    }
    
    // 尝试解析JSON
    let data;
    try {
      data = JSON.parse(responseText);
      console.log('=== Parsed JSON Successfully ===');
      console.log('Parsed data:', JSON.stringify(data, null, 2));
      
      // 检查是否有文件或图片信息
      if (data.files && data.files.length > 0) {
        console.log('=== Files found in response ===');
        console.log('Files:', JSON.stringify(data.files, null, 2));
      }
      if (data.metadata && data.metadata.files) {
        console.log('=== Files found in metadata ===');
        console.log('Metadata files:', JSON.stringify(data.metadata.files, null, 2));
      }
    } catch (parseError) {
      console.error('=== JSON Parse Error ===');
      console.error('Parse error:', parseError.message);
      console.error('Response text:', responseText);
      
      return res.status(502).json({
        error: {
          message: 'Invalid JSON response from Dify API',
          type: 'parse_error',
          details: `Parse error: ${parseError.message}`,
          raw_response: responseText.substring(0, 200)
        }
      });
    }
    
    // 检查Dify是否返回了error字段
    if (data.error) {
      console.error('Dify returned application error:', data.error);
      return res.status(400).json({
        error: {
          message: data.error,
          type: 'dify_application_error',
          code: 'dify_error'
        }
      });
    }
    
    // Dify原生API返回格式: {answer: "...", message_id: "...", metadata: {...}}
    // 转换为OpenAI格式
    if (data.answer) {
      // 处理内容：文本 + 可能的图片
      let content = data.answer;
      let contentArray = [];
      
      // 如果有文件，构建包含图片的content数组
      if (data.files && data.files.length > 0) {
        console.log('=== Processing files for OpenAI format ===');
        // 添加文本内容
        if (content.trim()) {
          contentArray.push({
            type: 'text',
            text: content
          });
        }
        
        // 添加图片
        data.files.forEach(file => {
          if (file.type && file.type.startsWith('image/')) {
            contentArray.push({
              type: 'image_url',
              image_url: {
                url: file.url || file.download_url || file.preview_url
              }
            });
          }
        });
      }
      
      const openaiResponse = {
        id: data.message_id || `chatcmpl-${Date.now()}`,
        object: 'chat.completion',
        created: Math.floor(Date.now() / 1000),
        model: req.body.model || 'o946LsohQnWlnIP0',
        choices: [{
          index: 0,
          message: {
            role: 'assistant',
            content: contentArray.length > 0 ? contentArray : content
          },
          finish_reason: 'stop'
        }],
        usage: {
          prompt_tokens: data.metadata?.usage?.prompt_tokens || 0,
          completion_tokens: data.metadata?.usage?.completion_tokens || 0,
          total_tokens: data.metadata?.usage?.total_tokens || 0
        }
      };
      
      console.log('=== Converted to OpenAI format ===');
      console.log(JSON.stringify(openaiResponse, null, 2));
      
      // 如果是流式请求，转换为SSE格式
      if (req.body.stream) {
        console.log('=== Converting to streaming format ===');
        res.setHeader('Content-Type', 'text/plain; charset=utf-8');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Connection', 'keep-alive');
        
        // 发送消息chunk
        const streamChunk = {
          id: openaiResponse.id,
          object: 'chat.completion.chunk',
          created: openaiResponse.created,
          model: openaiResponse.model,
          choices: [{
            index: 0,
            delta: {
              role: 'assistant',
              content: data.answer
            },
            finish_reason: null
          }]
        };
        
        res.write(`data: ${JSON.stringify(streamChunk)}\n\n`);
        
        // 发送结束chunk
        const endChunk = {
          id: openaiResponse.id,
          object: 'chat.completion.chunk',
          created: openaiResponse.created,
          model: openaiResponse.model,
          choices: [{
            index: 0,
            delta: {},
            finish_reason: 'stop'
          }]
        };
        
        // 如果有usage信息，包含在最后的chunk中
        if (req.body.stream_options?.include_usage) {
          endChunk.usage = openaiResponse.usage;
        }
        
        res.write(`data: ${JSON.stringify(endChunk)}\n\n`);
        res.write('data: [DONE]\n\n');
        res.end();
      } else {
        // 非流式响应
        res.setHeader('Content-Type', 'application/json');
        res.status(200).json(openaiResponse);
      }
      return;
    }
    
    // 如果既没有answer也没有choices，返回错误
    return res.status(502).json({
      error: {
        message: 'Invalid response format from Dify',
        type: 'format_error',
        details: 'Missing answer field in Dify response'
      }
    });
    
  } catch (error) {
    console.error('=== Proxy Error ===');
    console.error('Error:', error.message);
    console.error('Stack:', error.stack);
    res.status(500).json({
      error: {
        message: 'Internal proxy error: ' + error.message,
        type: 'proxy_error'
      }
    });
  }
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`=== Dify-LibreChat Proxy Started ===`);
  console.log(`Port: ${PORT}`);
  console.log(`Target: https://sti485grxs9qmgl0.ai-plugin.io`);
  console.log(`Endpoints: GET /v1/models, POST /v1/chat/completions`);
});