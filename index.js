// index.js
const express = require('express');
const OpenAI = require('openai');
const { twiml } = require('twilio');
const cookieParser = require('cookie-parser');
const dotenv = require('dotenv');
const ngrok = require('@ngrok/ngrok');
const { ChatOpenAI } = require('@langchain/openai');
const { MessagesAnnotation, StateGraph } = require('@langchain/langgraph');
const { SystemMessage, ToolMessage } = require('@langchain/core/messages');
const { CaseStatusTool } = require('./lib/getCaseDetails');
const { CreateCaseTool } = require('./lib/createCase'); // Import the new tool

dotenv.config();

const app = express();
const openAI = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const GREETING_MESSAGE = 'Hi, My self Rajnish. I am AI assistant, how can i help you?';

app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

// Initialize OpenAI LLM
const llm = new ChatOpenAI({
    openAIApiKey: process.env.OPENAI_API_KEY,
});

console.log('🔍 Initializing application...');

// Setup tools and bind to LLM
const tools = [new CaseStatusTool(), new CreateCaseTool()];
const toolsByName = Object.fromEntries(tools.map((tool) => [tool.name, tool]));
const llmWithTools = llm.bindTools(tools);
console.log('🔍 Tools initialized:', Object.keys(toolsByName));

// LangGraph setup
async function llmCall(state) {
    console.log('🔍 LLM Call: State messages:', JSON.stringify(state.messages, null, 2));
    const result = await llmWithTools.invoke([
        new SystemMessage(`You are a helpful phone assistant for Concret.io, a Salesforce consulting company.
                          Your name is Concret Assistant.
                          Your answers should be short and concise. If possible provide one line answers also.
                          You can check Salesforce case status when provided with a case number using the case_status tool.
                          You can also create new Salesforce cases using the create_case tool when asked to do so.
                          For case creation, ask for subject, description, contact name and contact email if not provided.
                          Make sure the origin is set to Phone.
                          Make sure to ask email address and name for case creation. If user is not providing it.`),
        ...state.messages,
    ]);
    console.log('🔍 LLM Call: Result:', JSON.stringify(result, null, 2));
    return { messages: [result] };
}

async function toolNode(state) {
    console.log('🔍 Tool Node: Processing state:', JSON.stringify(state.messages, null, 2));
    const results = [];
    const lastMessage = state.messages[state.messages.length - 1];
    console.log('🔍 Tool Node: Last message:', JSON.stringify(lastMessage, null, 2));
    
    if (lastMessage?.tool_calls?.length) {
        console.log(`🔍 Tool Node: Found ${lastMessage.tool_calls.length} tool calls`);
        for (const toolCall of lastMessage.tool_calls) {
            console.log('🔍 Tool Node: Processing tool call:', JSON.stringify(toolCall, null, 2));
            const tool = toolsByName[toolCall.name];
            if (tool) {
                try {
                    const observation = await tool._call(toolCall.args);
                    console.log('🔍 Tool Node: Tool result:', observation);
                    results.push(
                        new ToolMessage({
                            content: String(observation),
                            tool_call_id: toolCall.id,
                        })
                    );
                } catch (error) {
                    console.error('🔍 Tool Node: Error executing tool:', error.message);
                    results.push(
                        new ToolMessage({
                            content: `Error: ${error.message}`,
                            tool_call_id: toolCall.id,
                        })
                    );
                }
            } else {
                console.log(`🔍 Tool Node: Tool ${toolCall.name} not found`);
            }
        }
    } else {
        console.log('🔍 Tool Node: No tool calls found');
    }
    return { messages: results };
}

function shouldContinue(state) {
    const lastMessage = state.messages[state.messages.length - 1];
    console.log('🔍 Should Continue: Checking last message:', JSON.stringify(lastMessage, null, 2));
    const nextStep = lastMessage?.tool_calls?.length ? "tools" : "__end__";
    console.log(`🔍 Should Continue: Next step: ${nextStep}`);
    return nextStep;
}

const agent = new StateGraph(MessagesAnnotation)
    .addNode("llmCall", llmCall)
    .addNode("tools", toolNode)
    .addEdge("__start__", "llmCall")
    .addConditionalEdges("llmCall", shouldContinue, {
        tools: "tools",
        __end__: "__end__",
    })
    .addEdge("tools", "llmCall")
    .compile();
console.log('🔍 LangGraph agent compiled');

app.get('/', (req, res) => {
    const currentTime = new Date().toLocaleString();
    console.log('🔍 GET /: Current Time:', currentTime);
    res.send('<h1>Welcome to Test Page</h1>');
});

app.post('/incoming-call', (req, res) => {
    console.log('🔍 POST /incoming-call: Request received');
    const voiceResponse = new twiml.VoiceResponse();
    let messages = req.cookies.messages ? JSON.parse(req.cookies.messages) : null;
    console.log('🔍 POST /incoming-call: Existing messages:', messages);

    if (!messages) {
        messages = [
            {
                role: "assistant",
                content: GREETING_MESSAGE
            }
        ];
        console.log('🔍 POST /incoming-call: Setting initial messages:', messages);
        res.cookie('messages', JSON.stringify(messages));
        voiceResponse.say(GREETING_MESSAGE);
    }

    voiceResponse.gather({
        input: ['speech'],
        speechTimeout: 'auto',
        speechModel: 'experimental_conversations',
        enhanced: true,
        action: '/respond',
        method: 'POST'
    });

    console.log('🔍 POST /incoming-call: Sending response');
    res.type('text/xml');
    res.send(voiceResponse.toString());
});

app.post('/respond', async (req, res) => {
    console.log('🔍 POST /respond: Request received with body:', req.body);
    const voiceInput = req.body.SpeechResult;
    console.log('🔍 POST /respond: Voice input:', voiceInput);
    let messages = req.cookies.messages ? JSON.parse(req.cookies.messages) : [];
    console.log('🔍 POST /respond: Current messages:', messages);

    messages.push({ role: "user", content: voiceInput });
    console.log('🔍 POST /respond: Updated messages with user input:', messages);

    try {
        console.log('🔍 POST /respond: Invoking agent');
        const result = await agent.invoke({ messages });
        console.log('🔍 POST /respond: Agent result:', JSON.stringify(result, null, 2));
        
        const assistantResponse = result.messages[result.messages.length - 1].content;
        console.log('🔍 POST /respond: Assistant response:', assistantResponse);
        
        messages.push({ role: "assistant", content: assistantResponse });
        console.log('🔍 POST /respond: Final messages:', messages);
        
        res.cookie('messages', JSON.stringify(messages));
        console.log('🔍 POST /respond: Cookie set');

        const voiceResponse = new twiml.VoiceResponse();
        voiceResponse.say(assistantResponse);
        voiceResponse.redirect({ method: "POST" }, "/incoming-call");

        console.log('🔍 POST /respond: Sending response');
        res.type('text/xml');
        res.send(voiceResponse.toString());
    } catch (error) {
        console.error('🔍 POST /respond: Error processing request:', error);
        res.status(500).send("Error processing request");
    }
});

const port = process.env.PORT || 3000;

app.listen(port, async () => {
    console.log(`🔍 Server is running on: http://localhost:${port}`);

    if (process.env.NGROK_AUTH_TOKEN) {
        const NGROK_AUTH_TOKEN = process.env.NGROK_AUTH_TOKEN;
        try {
            const listener = await ngrok.forward({
                addr: port,
                authtoken: NGROK_AUTH_TOKEN,
            });
            console.log(`🔍 Ngrok tunnel established at: ${listener.url()}`);
        } catch (err) {
            console.error('🔍 Error establishing ngrok tunnel:', err);
        }
    } else {
        console.log('🔍 Ngrok is not enabled. Set NGROK_AUTH_TOKEN in .env to enable it.');
    }
});