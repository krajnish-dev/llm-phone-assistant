// index.js
const express = require('express');
const OpenAI = require('openai');
const path = require('path');
const fs = require('fs');
const { twiml } = require('twilio');
const cookieParser = require('cookie-parser');
const dotenv = require('dotenv');
const ngrok = require('@ngrok/ngrok');
const { ChatOpenAI } = require('@langchain/openai');
const { MessagesAnnotation, StateGraph } = require('@langchain/langgraph');
const { SystemMessage, ToolMessage } = require('@langchain/core/messages');
const { CaseStatusTool } = require('./lib/getCaseDetails');
const { CreateCaseTool } = require('./lib/createCase');
const {OrderSummaryStatusTool} = require('./lib/getOrderDetails');
const {GetOrderSummaryStatus_Ctrl} = require('./lib/getCustomerOrderDetails');
const { getOrderSummaryStatus } = require('./lib/apexService');

dotenv.config();

// const OrderDetails = [];
const app = express();

app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

// Initialize OpenAI LLM
const llm = new ChatOpenAI({
    openAIApiKey: process.env.OPENAI_API_KEY,
});

console.log('🔍 Initializing application...');

// Setup tools and bind to LLM
const tools = [new CaseStatusTool(), new CreateCaseTool(), new GetOrderSummaryStatus_Ctrl()];
const toolsByName = Object.fromEntries(tools.map((tool) => [tool.name, tool]));
const llmWithTools = llm.bindTools(tools);
console.log('🔍 Tools initialized:', Object.keys(toolsByName));

// LangGraph setup
async function llmCall(state) {
    console.log('🔍 LLM Call: State messages:', JSON.stringify(state.messages, null, 2));
    const result = await llmWithTools.invoke([
        new SystemMessage(`You are a helpful phone assistant for Concret.io, a Salesforce consulting company.
                          Your answers should be short and concise. If possible provide one line answers also.
                          You are here to help user with their order details.
                          `),
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

// -------------- INCOMING-CALL METHOD CALLING -------------------
app.post('/incoming-call', async (req, res) => {
    console.log('🔍 POST /incoming-call: Request received');

    const incomingNumber = req.body.From;
    console.log(`📞 Incoming call from: ${incomingNumber}`);

    const orderData = await getOrderSummaryStatus(incomingNumber);
    console.log(`🔍 Order Summary Status: ${orderData}`);

    let customerName = 'there';
    if (orderData) {
        const parsedData = JSON.parse(orderData);
        if (Array.isArray(parsedData) && parsedData.length > 0 && parsedData[0].Name) {
            customerName = parsedData[0].Name;
        }
    }

    const GREETING_MESSAGE = `Hi ${customerName}, I am your AI assistant. I'm here to help you with your order details. How can I assist you today?`;

    const voiceResponse = new twiml.VoiceResponse();
    let messages = req.cookies.messages ? JSON.parse(req.cookies.messages) : null;

    if (!messages) {
        messages = [
            {
                role: "assistant",
                content: GREETING_MESSAGE
            }
        ];
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

    // 🔽 Write order data to a text file
    try {
         const outputDir = path.join(__dirname, 'tempLogs');
        if (!fs.existsSync(outputDir)) {
            fs.mkdirSync(outputDir, { recursive: true });
        }
        const outputPath = path.join(outputDir, 'tempOrderDetails.txt');

        const orderDetails = JSON.parse(orderData);
        // Validate orderDetails
        if (orderDetails==null || orderDetails.length === 0) {
            const errorText = "No order details received from the server.";
            fs.writeFileSync(outputPath, errorText);
            console.log(`✅ Empty order details written to ${outputPath}: ${errorText}`);
            res.type('text/xml');
            return res.send(voiceResponse.toString());
        }


        // Format the order details as a string
        let formattedText = `Order Summary for ${orderDetails[0].Name || 'Unknown Customer'}\n`;
        formattedText += `Contact ID: ${orderDetails[0].Id || 'N/A'}\n`;
        formattedText += `Total Orders: ${orderDetails[0].UserOrders__r?.totalSize || 0}\n\n`;

        const orders = orderDetails[0]?.UserOrders__r?.records;
        if (orders && Array.isArray(orders) && orders.length > 0) {
            formattedText += "Order Details:\n";
            orders.forEach((order, index) => {
                formattedText += `Order ${index + 1}:\n`;
                formattedText += `  Order Number: ${order.Name || 'N/A'}\n`;
                formattedText += `  Product: ${order.Product_VB__r?.Name || 'N/A'}\n`;
                formattedText += `  Quantity: ${order.Product_Quantity__c ?? 0}\n`;
                formattedText += `  Price per Unit: $${(order.Product_VB__r?.Price__c ?? 0).toFixed(2)}\n`;
                formattedText += `  Total Amount: $${(order.Total_Amount__c ?? 0).toFixed(2)}\n`;
                formattedText += `  Order Date: ${order.Order_Date__c ? new Date(order.Order_Date__c).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' }) : 'N/A'}\n`;
                formattedText += `  Status: ${order.Order_Status__c || 'N/A'}\n`;
                if (order.Shipping_Address__City__s) {
                    formattedText += `  Shipping City: ${order.Shipping_Address__City__s}\n`;
                }
                formattedText += "\n";
            });
        } else {
            formattedText += "No orders found for this customer.\n";
        }

        // Write to file
        fs.writeFileSync(outputPath, formattedText);
        console.log(`✅ Order details written to ${outputPath}`);
        console.log(`🔍 Written content preview:`, formattedText.slice(0, 200) + (formattedText.length > 200 ? '...' : ''));

    } 
    catch (err) {
        console.error('❌ Error fetching or writing order details:', err);
        const outputDir = path.join(__dirname, 'tempLogs');
        if (!fs.existsSync(outputDir)) {
            fs.mkdirSync(outputDir, { recursive: true });
        }
        const outputPath = path.join(outputDir, 'tempOrderDetails.txt');
        const errorText = `Error: Unable to fetch or process order details - ${err.message}`;
        fs.writeFileSync(outputPath, errorText);
        console.log(`✅ Error written to ${outputPath}: ${errorText}`);
    }    

    console.log('🔍 POST /incoming-call: Sending response');
    res.type('text/xml');
    res.send(voiceResponse.toString());
});



// -------------- RESPOND METHOD CALLING -------------------
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