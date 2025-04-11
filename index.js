const express = require("express");
const { twiml } = require("twilio");
const session = require("express-session");
const dotenv = require("dotenv");
const { ChatOpenAI } = require("@langchain/openai");
const { MessagesAnnotation, StateGraph } = require("@langchain/langgraph");
const { SystemMessage, ToolMessage } = require("@langchain/core/messages");
const { CaseStatusTool } = require("./lib/getCaseDetails");
const { CreateCaseTool } = require("./lib/createCase");
const { getOrderSummaryStatus } = require("./lib/apexService");
const { UpdateDeliveryDateTool } = require("./lib/updateDeliveyDate");
const { getSystemPrompt } = require("./prompts");
const { handleVoiceInput } = require("./intents/orderIntent");
const ngrok = require("@ngrok/ngrok");

dotenv.config();

const app = express();

app.use(express.urlencoded({ extended: true }));

// Initialize session middleware
app.use(
  session({
    secret: process.env.SESSION_SECRET || "your-secret-key",
    resave: false,
    saveUninitialized: false,
    cookie: { maxAge: 24 * 60 * 60 * 1000 },
  })
);

// Initialize OpenAI LLM
const llm = new ChatOpenAI({
  openAIApiKey: process.env.OPENAI_API_KEY,
});

console.log("🔍 Initializing application...");

// Setup tools and bind to LLM
const tools = [
  new CaseStatusTool(),
  new CreateCaseTool(),
  new UpdateDeliveryDateTool(),
];
const toolsByName = Object.fromEntries(tools.map((tool) => [tool.name, tool]));
const llmWithTools = llm.bindTools(tools);
console.log("🔍 Tools initialized:", Object.keys(toolsByName));

// LangGraph setup
async function llmCall(state) {
  console.log("🔍 LLM Call: State messages:", JSON.stringify(state.messages, null, 2));
  const orderDetailsArray = state.orderDetailsArray || [];
  const systemPrompt = getSystemPrompt(orderDetailsArray);
  const result = await llmWithTools.invoke([
    new SystemMessage(systemPrompt),
    ...state.messages,
  ]);
  console.log("🔍 LLM Call: Result:", JSON.stringify(result, null, 2));
  return { messages: [result] };
}

async function toolNode(state) {
  console.log("🔍 Tool Node: Processing state:", JSON.stringify(state.messages, null, 2));
  const results = [];
  const lastMessage = state.messages[state.messages.length - 1];
  console.log("🔍 Tool Node: Last message:", JSON.stringify(lastMessage, null, 2));

  if (lastMessage?.tool_calls?.length) {
    console.log(`🔍 Tool Node: Found ${lastMessage.tool_calls.length} tool calls`);
    for (const toolCall of lastMessage.tool_calls) {
      console.log("🔍 Tool Node: Processing tool call:", JSON.stringify(toolCall, null, 2));
      const tool = toolsByName[toolCall.name];
      if (tool) {
        try {
          const observation = await tool._call(toolCall.args);
          console.log("🔍 Tool Node: Tool result:", observation);
          results.push(
            new ToolMessage({
              content: String(observation),
              tool_call_id: toolCall.id,
            })
          );
        } catch (error) {
          console.error("🔍 Tool Node: Error executing tool:", error.message);
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
    console.log("🔍 Tool Node: No tool calls found");
  }
  return { messages: results };
}

function shouldContinue(state) {
  const lastMessage = state.messages[state.messages.length - 1];
  console.log("🔍 Should Continue: Checking last message:", JSON.stringify(lastMessage, null, 2));
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
console.log("🔍 LangGraph agent compiled");

app.get("/", (req, res) => {
  const currentTime = new Date().toLocaleString();
  console.log("🔍 GET /: Current Time:", currentTime);
  res.send("<h1>Welcome to Test Page</h1>");
});

// -------------- INCOMING-CALL METHOD CALLING -------------------
app.post("/incoming-call", async (req, res) => {
  console.log("🔍 POST /incoming-call: Request received");
  const incomingNumber = req.body.From;
  console.log(`📞 Incoming call from: ${incomingNumber}`);

  let orderData = req.session.orderData || null;
  let orderDetailsArray = req.session.orderDetailsArray || [];

  if (!orderData) {
    orderData = await getOrderSummaryStatus(incomingNumber);
    console.log(`🔍 Order Summary Status: ${orderData}`);
    req.session.orderData = orderData;

    const parsedData = JSON.parse(orderData);
    if (parsedData && Array.isArray(parsedData) && parsedData.length > 0) {
      const orders = parsedData[0]?.UserOrders__r?.records || [];
      orderDetailsArray = orders.map((order, index) => ({
        orderNumber: index + 1,
        product: order.Product_VB__r?.Name || "N/A",
        quantity: order.Product_Quantity__c ?? 0,
        pricePerUnit: order.Product_VB__r?.Price__c ?? 0,
        totalAmount: order.Total_Amount__c ?? 0,
        orderDate: order.Order_Date__c
          ? new Date(order.Order_Date__c).toLocaleDateString("en-US", {
              year: "numeric",
              month: "short",
              day: "numeric",
            })
          : "N/A",
        status: order.Order_Status__c || "N/A",
        shippingCity: order.Shipping_Address__City__s || null,
      }));
    } else {
      orderDetailsArray = [];
    }
    req.session.orderDetailsArray = orderDetailsArray;
    console.log("🔍 Order Details Array:", JSON.stringify(orderDetailsArray, null, 2));
  }

  let customerName = "there";
  if (orderData) {
    const parsedData = JSON.parse(orderData);
    if (Array.isArray(parsedData) && parsedData.length > 0 && parsedData[0].Name) {
      customerName = parsedData[0].Name;
    }
  }

  const GREETING_MESSAGE = `Hi ${customerName}, I am your AI assistant. I'm here to help you with your order details. How can I assist you today?`;

  const voiceResponse = new twiml.VoiceResponse();
  let messages = req.session.messages || [];

  if (messages.length === 0) {
    messages.push({ role: "assistant", content: GREETING_MESSAGE });
    voiceResponse.say({ voice: "Polly.Joanna", language: "en-US" }, GREETING_MESSAGE);
  }
  req.session.messages = messages;

  voiceResponse.gather({
    input: ["speech"],
    speechTimeout: "auto",
    speechModel: "phone_call",
    enhanced: true,
    action: "/respond",
    method: "POST",
  });

  console.log("🔍 POST /incoming-call: Sending response");
  res.type("text/xml");
  res.send(voiceResponse.toString());
});

// -------------- RESPOND METHOD CALLING -------------------
app.post("/respond", async (req, res) => {
  console.log("🔍 POST /respond: Request received with body:", req.body);
  const voiceInput = req.body.SpeechResult.toLowerCase();
  console.log("🔍 POST /respond: Voice input:", voiceInput);
  let messages = req.session.messages || [];
  const orderDetailsArray = req.session.orderDetailsArray || [];

  messages.push({ role: "user", content: voiceInput });

  const voiceResponse = new twiml.VoiceResponse();
  try {
    const assistantResponse = await handleVoiceInput(voiceInput, orderDetailsArray, agent, messages);

    messages.push({ role: "assistant", content: assistantResponse });
    if (messages.length > 10) messages = messages.slice(-10);
    req.session.messages = messages;
    console.log("🔍 POST /respond: Final messages:", messages);

    voiceResponse.say({ voice: "Polly.Joanna", language: "en-US" }, assistantResponse);
  } catch (error) {
    console.error("🔍 POST /respond: Error processing request:", error.stack);
    const assistantResponse = "Sorry, I’m having trouble processing your request. Please try again.";
    voiceResponse.say({ voice: "Polly.Joanna", language: "en-US" }, assistantResponse);
  }

  voiceResponse.gather({
    input: ["speech"],
    speechTimeout: "auto",
    speechModel: "phone_call",
    enhanced: true,
    action: "/respond",
    method: "POST",
  });

  console.log("🔍 POST /respond: Sending response");
  res.type("text/xml");
  res.send(voiceResponse.toString());
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
      console.error("🔍 Error establishing ngrok tunnel:", err);
    }
  } else {
    console.log("🔍 Ngrok is not enabled. Set NGROK_AUTH_TOKEN in .env to enable it.");
  }
});