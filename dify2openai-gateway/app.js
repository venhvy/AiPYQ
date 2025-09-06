import express from "express";
import bodyParser from "body-parser";
import dotenv from "dotenv";
import fetch from "node-fetch";
dotenv.config();

if (!process.env.DIFY_API_URL) throw new Error("DIFY API URL is required.");
function generateId() {
  let result = "";
  const characters =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  for (let i = 0; i < 29; i++) {
    result += characters.charAt(Math.floor(Math.random() * characters.length));
  }
  return result;
}
const app = express();
app.use(bodyParser.json());
const botType = process.env.BOT_TYPE || 'Chat';
const inputVariable = process.env.INPUT_VARIABLE || '';
const outputVariable = process.env.OUTPUT_VARIABLE || '';

let apiPath;
switch (botType) {
  case 'Chat':
    apiPath = '/chat-messages';
    break;
  case 'Completion':
    apiPath = '/completion-messages';
    break;
  case 'Workflow':
    apiPath = '/workflows/run';
    break;
  default:
    throw new Error('Invalid bot type in the environment variable.');
}
var corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers":
    "DNT,User-Agent,X-Requested-With,If-Modified-Since,Cache-Control,Content-Type,Range,Authorization",
  "Access-Control-Max-Age": "86400",
};

app.use((req, res, next) => {
  res.set(corsHeaders);
  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }
  console.log('Request Method:', req.method); 
  console.log('Request Path:', req.path);
  next();
});

app.get('/', (req, res) => {
  res.send(`
    <html>
      <head>
        <title>DIFY2OPENAI</title>
      </head>
      <body>
        <h1>Dify2OpenAI</h1>
        <p>Congratulations! Your project has been successfully deployed.</p>
        <p>Bot Type: ${botType}</p>
        <p>API Path: ${apiPath}</p>
        <p>Dify API URL: ${process.env.DIFY_API_URL}</p>
      </body>
    </html>
  `);
});

app.get('/v1/models', (req, res) => {
  const models = {
    "object": "list",
    "data": [
      {
        "id": process.env.MODELS_NAME || "gpt-3.5-turbo",
        "object": "model",
        "owned_by": "dify",
        "permission": null,
      }
    ]
  };
  res.json(models);
});

// 支持两种路径
app.get('/models', (req, res) => {
  const models = {
    "object": "list",
    "data": [
      {
        "id": process.env.MODELS_NAME || "gpt-3.5-turbo",
        "object": "model",
        "owned_by": "dify",
        "permission": null,
      }
    ]
  };
  res.json(models);
});

async function handleChatCompletions(req, res) {
  const authHeader = req.headers["authorization"] || req.headers["Authorization"];
  if (!authHeader) {
    return res.status(401).json({
      code: 401,
      errmsg: "Unauthorized.",
    });
  } else {
    const token = authHeader.split(" ")[1];
    if (!token) {
      return res.status(401).json({
        code: 401,
        errmsg: "Unauthorized.",
      });
    }
  }
  
  try {
    const data = req.body;
    const messages = data.messages;
    let queryString;
    if (botType === 'Chat') {
      const lastMessage = messages[messages.length - 1];
      queryString = `here is our talk history:\n'''\n${messages
        .slice(0, -1) 
        .map((message) => `${message.role}: ${message.content}`)
        .join('\n')}\n'''\n\nhere is my question:\n${lastMessage.content}`;
    } else if (botType === 'Completion' || botType === 'Workflow') {
      queryString = messages[messages.length - 1].content;
    }
    
    const stream = data.stream !== undefined ? data.stream : false;
    let requestBody;
    if (inputVariable) {
      requestBody = {
        inputs: { [inputVariable]: queryString },
        response_mode: stream ? "streaming" : "blocking",
        conversation_id: "",
        user: "apiuser",
        auto_generate_name: false
      };
    } else {
      requestBody = {
        "inputs": {},
        query: queryString,
        response_mode: stream ? "streaming" : "blocking",
        conversation_id: "",
        user: "apiuser",
        auto_generate_name: false
      };
    }

    console.log('Sending request to Dify:', JSON.stringify(requestBody, null, 2));
    
    const resp = await fetch(process.env.DIFY_API_URL + apiPath, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${authHeader.split(" ")[1]}`,
      },
      body: JSON.stringify(requestBody),
    });

    if (!resp.ok) {
      console.error('Dify API error:', resp.status, resp.statusText);
      const errorText = await resp.text();
      console.error('Error response:', errorText);
      return res.status(resp.status).json({ 
        error: `Dify API error: ${resp.status} ${resp.statusText}`,
        details: errorText
      });
    }

    if (!stream) {
      // 非流式处理 - 等待完整响应
      const responseData = await resp.json();
      console.log('Non-streaming response:', JSON.stringify(responseData, null, 2));
      
      let result = "";
      if (responseData.answer) {
        result = responseData.answer;
      } else if (responseData.data && responseData.data.outputs) {
        const outputs = responseData.data.outputs;
        if (outputVariable) {
          result = outputs[outputVariable];
        } else {
          result = JSON.stringify(outputs);
        }
      }
      
      const formattedResponse = {
        id: `chatcmpl-${generateId()}`,
        object: "chat.completion",
        created: Math.floor(Date.now() / 1000),
        model: data.model,
        choices: [
          {
            index: 0,
            message: {
              role: "assistant",
              content: result.trim(),
            },
            logprobs: null,
            finish_reason: "stop",
          },
        ],
        usage: {
          prompt_tokens: responseData.metadata?.usage?.prompt_tokens || 100,
          completion_tokens: responseData.metadata?.usage?.completion_tokens || 10,
          total_tokens: responseData.metadata?.usage?.total_tokens || 110,
        },
        system_fingerprint: "fp_2f57f81c11",
      };
      
      res.json(formattedResponse);
      return;
    }

    // 流式处理
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    
    let buffer = "";
    let hasResponse = false;
    let fullAnswer = "";
    
    const timeout = setTimeout(() => {
      if (!hasResponse) {
        console.log('Request timeout, sending error response');
        res.write(`data: ${JSON.stringify({ error: "Request timeout" })}\n\n`);
        res.write("data: [DONE]\n\n");
        res.end();
      }
    }, 30000); // 30秒超时

    resp.body.on("data", (chunk) => {
      clearTimeout(timeout);
      hasResponse = true;
      
      buffer += chunk.toString();
      let lines = buffer.split("\n");

      for (let i = 0; i < lines.length - 1; i++) {
        let line = lines[i].trim();
        if (!line.startsWith("data:")) continue;
        line = line.slice(5).trim();
        
        let chunkObj;
        try {
          if (line.startsWith("{")) {
            chunkObj = JSON.parse(line);
          } else {
            continue;
          }
        } catch (error) {
          console.error("Error parsing chunk:", error);
          continue;
        }

        console.log('Event:', chunkObj.event);
        
        // 处理各种Dify事件类型
        if (chunkObj.event === "message" || chunkObj.event === "agent_message") {
          if (chunkObj.answer) {
            fullAnswer += chunkObj.answer;
            const chunkId = `chatcmpl-${Date.now()}`;
            res.write(
              "data: " +
                JSON.stringify({
                  id: chunkId,
                  object: "chat.completion.chunk",
                  created: chunkObj.created_at || Math.floor(Date.now() / 1000),
                  model: data.model,
                  choices: [
                    {
                      index: 0,
                      delta: {
                        content: chunkObj.answer,
                      },
                      finish_reason: null,
                    },
                  ],
                }) +
                "\n\n"
            );
          }
        } else if (chunkObj.event === "workflow_finished" || chunkObj.event === "message_end") {
          // 发送结束信号
          const chunkId = `chatcmpl-${Date.now()}`;
          res.write(
            "data: " +
              JSON.stringify({
                id: chunkId,
                object: "chat.completion.chunk",
                created: chunkObj.created_at || Math.floor(Date.now() / 1000),
                model: data.model,
                choices: [
                  {
                    index: 0,
                    delta: {},
                    finish_reason: "stop",
                  },
                ],
              }) +
              "\n\n"
          );
          res.write("data: [DONE]\n\n");
          res.end();
          return;
        } else if (chunkObj.event === "error") {
          console.error(`Dify error: ${chunkObj.code}, ${chunkObj.message}`);
          res.write(`data: ${JSON.stringify({ error: chunkObj.message })}\n\n`);
          res.write("data: [DONE]\n\n");
          res.end();
          return;
        }
      }

      buffer = lines[lines.length - 1];
    });

    resp.body.on("end", () => {
      clearTimeout(timeout);
      if (hasResponse) {
        // 如果没有正常结束，发送结束信号
        if (!res.headersSent) {
          const chunkId = `chatcmpl-${Date.now()}`;
          res.write(
            "data: " +
              JSON.stringify({
                id: chunkId,
                object: "chat.completion.chunk",
                created: Math.floor(Date.now() / 1000),
                model: data.model,
                choices: [
                  {
                    index: 0,
                    delta: {},
                    finish_reason: "stop",
                  },
                ],
              }) +
              "\n\n"
          );
        }
        res.write("data: [DONE]\n\n");
        res.end();
      }
    });

    resp.body.on("error", (error) => {
      clearTimeout(timeout);
      console.error("Stream error:", error);
      if (!res.headersSent) {
        res.status(500).json({ error: "Stream processing error" });
      }
    });

  } catch (error) {
    console.error("Error:", error);
    res.status(500).json({ error: "Internal server error: " + error.message });
  }
}

// 支持两种路径的chat completions
app.post("/v1/chat/completions", handleChatCompletions);
app.post("/chat/completions", handleChatCompletions);

app.listen(process.env.PORT || 3000, () => {
  console.log(`Server running on port ${process.env.PORT || 3000}`);
  console.log(`Bot Type: ${botType}`);
  console.log(`API Path: ${apiPath}`);
  console.log(`Dify API URL: ${process.env.DIFY_API_URL}`);
});