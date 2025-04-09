const express = require("express");
const OpenAI = require("openai");
const path = require("path");
const fs = require("fs");
const { twiml } = require("twilio");
const cookieParser = require("cookie-parser");
const dotenv = require("dotenv");
const ngrok = require("@ngrok/ngrok");
const { ChatOpenAI } = require("@langchain/openai");
const { MessagesAnnotation, StateGraph } = require("@langchain/langgraph");
const { SystemMessage, ToolMessage } = require("@langchain/core/messages");
const { CaseStatusTool } = require("./lib/getCaseDetails");
const { CreateCaseTool } = require("./lib/createCase");
const { getOrderSummaryStatus } = require("./lib/apexService");
const { UpdateDeliveryDateTool } = require("./lib/updateDeliveyDate");
const { getSystemPrompt } = require("./prompts");

dotenv.config();

const app = express();

app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

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

  // Check if order data is already in cookies
  let orderData = req.cookies.orderData ? JSON.parse(req.cookies.orderData) : null;
  let orderDetailsArray = [];

  if (!orderData) {
    // Fetch order data only if it’s not already stored
    orderData = await getOrderSummaryStatus(incomingNumber);
    console.log(`🔍 Order Summary Status: ${orderData}`);
    res.cookie("orderData", JSON.stringify(orderData)); // Store in cookies

    // Parse order data into an array of objects
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
      orderDetailsArray = []; // Empty array if no orders
    }
    res.cookie("orderDetailsArray", JSON.stringify(orderDetailsArray)); // Store array in cookies
    console.log("🔍 Order Details Array:", JSON.stringify(orderDetailsArray, null, 2));
  } else {
    // Use existing orderDetailsArray from cookies
    orderDetailsArray = req.cookies.orderDetailsArray
      ? JSON.parse(req.cookies.orderDetailsArray)
      : [];
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
  let messages = req.cookies.messages ? JSON.parse(req.cookies.messages) : null;

  if (!messages) {
    messages = [{ role: "assistant", content: GREETING_MESSAGE }];
    res.cookie("messages", JSON.stringify(messages));
    voiceResponse.say({ voice: "Polly.Joanna", language: "en-US" }, GREETING_MESSAGE);
  }

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
  let messages = req.cookies.messages ? JSON.parse(req.cookies.messages) : [];
  const orderDetailsArray = req.cookies.orderDetailsArray
    ? JSON.parse(req.cookies.orderDetailsArray)
    : [];

  messages.push({ role: "user", content: voiceInput });

  try {
    let assistantResponse = "I'm sorry, I couldn't process your request.";

    if (voiceInput.includes("order") || voiceInput.includes("product")) {
      if (orderDetailsArray.length === 0) {
        assistantResponse = "I don't have any order details for you at the moment.";
      } else if (voiceInput.includes("recent")) {
        const recentOrder = orderDetailsArray[orderDetailsArray.length - 1];
        assistantResponse = `Your most recent order is: Product: ${recentOrder.product}, Quantity: ${recentOrder.quantity}, Status: ${recentOrder.status}, Ordered on: ${recentOrder.orderDate}.`;
      } else if (voiceInput.includes("status")) {
        let statusResponse = "Your order statuses:\n";
        orderDetailsArray.forEach((order) => {
          statusResponse += `Order ${order.orderNumber} - Status: ${order.status}\n`;
        });
        assistantResponse = statusResponse;
      } else {
        let productList = "Here are the products you ordered:\n";
        orderDetailsArray.forEach((order) => {
          productList += `- ${order.product}\n`;
        });
        assistantResponse = productList;
      }
    } else {
      // Pass orderDetailsArray to LLM for non-order-specific queries
      messages.push({
        role: "system",
        content: `Order details available: ${JSON.stringify(orderDetailsArray)}`,
      });
      const result = await agent.invoke({ messages });
      assistantResponse = result.messages[result.messages.length - 1].content;
    }

    messages.push({ role: "assistant", content: assistantResponse });
    res.cookie("messages", JSON.stringify(messages));
    console.log("🔍 POST /respond: Final messages:", messages);

    const voiceResponse = new twiml.VoiceResponse();
    voiceResponse.say({ voice: "Polly.Joanna", language: "en-US" }, assistantResponse);
    voiceResponse.redirect({ method: "POST" }, "/incoming-call");

    console.log("🔍 POST /respond: Sending response");
    res.type("text/xml");
    res.send(voiceResponse.toString());
  } catch (error) {
    console.error("🔍 POST /respond: Error processing request:", error);
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
      console.error("🔍 Error establishing ngrok tunnel:", err);
    }
  } else {
    console.log("🔍 Ngrok is not enabled. Set NGROK_AUTH_TOKEN in .env to enable it.");
  }
});