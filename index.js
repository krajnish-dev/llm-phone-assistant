// index.js
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
const { OrderSummaryStatusTool } = require("./lib/getOrderDetails");
const { GetOrderSummaryStatus_Ctrl } = require("./lib/getCustomerOrderDetails");
const { getOrderSummaryStatus } = require("./lib/apexService");

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
  new GetOrderSummaryStatus_Ctrl(),
];
const toolsByName = Object.fromEntries(tools.map((tool) => [tool.name, tool]));
const llmWithTools = llm.bindTools(tools);
console.log("🔍 Tools initialized:", Object.keys(toolsByName));

// LangGraph setup (unchanged)
async function llmCall(state) {
  console.log(
    "🔍 LLM Call: State messages:",
    JSON.stringify(state.messages, null, 2)
  );
  const result = await llmWithTools.invoke([
    new SystemMessage(`You are a phone assistant for a customer voice service company. Your role is to help users with queries related to their orders
                        Keep your answers short, friendly, and concise. Prefer one-line responses when possible.
                        Provide order information by reading from tempOrderDetails.txt. Do not make API calls.
                        When sharing order details, mention the user's name only in the first response. Use "you" or "your" in following messages.
                        Avoid repeating the phrase "order summary" unless the user explicitly asks for it.
                        Maintain a polite and helpful tone throughout the conversation.`),
    ...state.messages,
  ]);
  console.log("🔍 LLM Call: Result:", JSON.stringify(result, null, 2));
  return { messages: [result] };
}

async function toolNode(state) {
  console.log(
    "🔍 Tool Node: Processing state:",
    JSON.stringify(state.messages, null, 2)
  );
  const results = [];
  const lastMessage = state.messages[state.messages.length - 1];
  console.log(
    "🔍 Tool Node: Last message:",
    JSON.stringify(lastMessage, null, 2)
  );

  if (lastMessage?.tool_calls?.length) {
    console.log(
      `🔍 Tool Node: Found ${lastMessage.tool_calls.length} tool calls`
    );
    for (const toolCall of lastMessage.tool_calls) {
      console.log(
        "🔍 Tool Node: Processing tool call:",
        JSON.stringify(toolCall, null, 2)
      );
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
  console.log(
    "🔍 Should Continue: Checking last message:",
    JSON.stringify(lastMessage, null, 2)
  );
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

  const orderData = await getOrderSummaryStatus(incomingNumber);
  console.log(`🔍 Order Summary Status: ${orderData}`);

  let customerName = "there";
  if (orderData) {
    const parsedData = JSON.parse(orderData);
    if (
      Array.isArray(parsedData) &&
      parsedData.length > 0 &&
      parsedData[0].Name
    ) {
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
        content: GREETING_MESSAGE,
      },
    ];
    res.cookie("messages", JSON.stringify(messages));
    voiceResponse.say(GREETING_MESSAGE);
  }

  voiceResponse.gather({
    input: ["speech"],
    speechTimeout: "auto",
    speechModel: "experimental_conversations",
    enhanced: true,
    action: "/respond",
    method: "POST",
  });

  // Write order data to a text file
  try {
    const outputDir = path.join(__dirname, "tempLogs");
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }
    const outputPath = path.join(outputDir, "tempOrderDetails.txt");

    const orderDetails = JSON.parse(orderData);
    // Validate orderDetails
    if (orderDetails == null || orderDetails.length === 0) {
      const errorText = "No order details received from the server.";
      fs.writeFileSync(outputPath, errorText);
      console.log(
        `✅ Empty order details written to ${outputPath}: ${errorText}`
      );
    } else {
      // Format the order details as a string
      let formattedText = `Order Summary for ${
        orderDetails[0].Name || "Unknown Customer"
      }\n`;
      formattedText += `Total Orders: ${
        orderDetails[0].UserOrders__r?.totalSize || 0
      }\n\n`;

      const orders = orderDetails[0]?.UserOrders__r?.records;
      if (orders && Array.isArray(orders) && orders.length > 0) {
        formattedText += "Order Details:\n";
        orders.forEach((order, index) => {
          formattedText += `Order ${index + 1}:\n`;
          // formattedText += `  Order Number: ${order.Name || 'N/A'}\n`;
          formattedText += `  Product: ${order.Product_VB__r?.Name || "N/A"}\n`;
          formattedText += `  Quantity: ${order.Product_Quantity__c ?? 0}\n`;
          formattedText += `  Price per Unit: $${(
            order.Product_VB__r?.Price__c ?? 0
          ).toFixed(2)}\n`;
          formattedText += `  Total Amount: $${(
            order.Total_Amount__c ?? 0
          ).toFixed(2)}\n`;
          formattedText += `  Order Date: ${
            order.Order_Date__c
              ? new Date(order.Order_Date__c).toLocaleDateString("en-US", {
                  year: "numeric",
                  month: "short",
                  day: "numeric",
                })
              : "N/A"
          }\n`;
          formattedText += `  Status: ${order.Order_Status__c || "N/A"}\n`;
          if (order.Shipping_Address__City__s) {
            formattedText += `  Shipping City: ${order.Shipping_Address__City__s}\n`;
          }
          formattedText += "\n";
        });
      } else {
        formattedText += "No orders found for this customer.\n";
      }

      fs.writeFileSync(outputPath, formattedText);
      console.log(`✅ Order details written to ${outputPath}`);
      console.log(
        `🔍 Written content preview:`,
        formattedText.slice(0, 200) + (formattedText.length > 200 ? "..." : "")
      );
    }
  } catch (err) {
    console.error("❌ Error fetching or writing order details:", err);
    const outputDir = path.join(__dirname, "tempLogs");
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }
    const outputPath = path.join(outputDir, "tempOrderDetails.txt");
    const errorText = `Error: Unable to fetch or process order details - ${err.message}`;
    fs.writeFileSync(outputPath, errorText);
    console.log(`✅ Error written to ${outputPath}: ${errorText}`);
  }

  console.log("🔍 POST /incoming-call: Sending response");
  res.type("text/xml");
  res.send(voiceResponse.toString());
});

// -------------- RESPOND METHOD CALLING -------------------
app.post("/respond", async (req, res) => {
  console.log("🔍 POST /respond: Request received with body:", req.body);
  const voiceInput = req.body.SpeechResult.toLowerCase(); // Convert to lowercase for easier matching
  console.log("🔍 POST /respond: Voice input:", voiceInput);
  let messages = req.cookies.messages ? JSON.parse(req.cookies.messages) : [];
  console.log("🔍 POST /respond: Current messages:", messages);

  messages.push({ role: "user", content: voiceInput });
  console.log("🔍 POST /respond: Updated messages with user input:", messages);

  try {
    const outputPath = path.join(__dirname, "tempLogs", "tempOrderDetails.txt");
    let assistantResponse = "I'm sorry, I couldn't process your request.";

    // Check if the request is about orders
    if (
      voiceInput.includes("order") ||
      voiceInput.includes("recent") ||
      voiceInput.includes("status")
    ) {
      if (fs.existsSync(outputPath)) {
        const fileContent = fs.readFileSync(outputPath, "utf8");
        console.log("🔍 POST /respond: File content:", fileContent);

        // Simple parsing of the file content
        if (
          fileContent.includes("No order details received") ||
          fileContent.includes("No orders found")
        ) {
          assistantResponse =
            "I don't have any order details for you at the moment.";
        } else if (voiceInput.includes("recent")) {
          // Extract recent orders (assuming most recent is the last one or sorted by date)
          const orderLines = fileContent.split("\n");
          let recentOrder = "";
          let foundOrder = false;
          for (let i = orderLines.length - 1; i >= 0; i--) {
            if (orderLines[i].startsWith("Order ")) {
              recentOrder = orderLines.slice(i, i + 8).join("\n"); // Adjust based on order block size
              foundOrder = true;
              break;
            }
          }
          if (foundOrder) {
            assistantResponse = `Your most recent order is:\n${recentOrder}`;
          } else {
            assistantResponse = "I couldn't find any recent orders.";
          }
        } else if (voiceInput.includes("status")) {
          // Provide status of all orders
          const orderLines = fileContent.split("\n");
          let statusResponse = "Here are your order statuses:\n";
          let hasOrders = false;
          for (let i = 0; i < orderLines.length; i++) {
            if (orderLines[i].startsWith("Order ")) {
              const statusLine = orderLines[i + 6]; // Assuming "Status" is 6 lines after "Order X"
              statusResponse += `${orderLines[i]} - ${statusLine}\n`;
              hasOrders = true;
            }
          }
          assistantResponse = hasOrders
            ? statusResponse
            : "No order statuses available.";
        } else {
          // General order list
          const orderLines = fileContent.split("\n");
          let orderList = "Here are your orders:\n";
          let hasOrders = false;
          for (let i = 0; i < orderLines.length; i++) {
            if (orderLines[i].startsWith("Order ")) {
              orderList += `${orderLines[i]}: ${orderLines[i + 1]} - ${
                orderLines[i + 2]
              }\n`; // Order Number and Product
              hasOrders = true;
              i += 7; // Skip to next order block
            }
          }
          assistantResponse = hasOrders
            ? orderList
            : "No orders found in the records.";
        }
      } else {
        assistantResponse =
          "I couldn't find the order details file. Please try again later.";
      }
    } else {
      // Use LLM for non-order-related queries
      const result = await agent.invoke({ messages });
      assistantResponse = result.messages[result.messages.length - 1].content;
    }

    messages.push({ role: "assistant", content: assistantResponse });
    console.log("🔍 POST /respond: Final messages:", messages);

    res.cookie("messages", JSON.stringify(messages));
    console.log("🔍 POST /respond: Cookie set");

    const voiceResponse = new twiml.VoiceResponse();
    voiceResponse.say(assistantResponse);
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
    console.log(
      "🔍 Ngrok is not enabled. Set NGROK_AUTH_TOKEN in .env to enable it."
    );
  }
});
