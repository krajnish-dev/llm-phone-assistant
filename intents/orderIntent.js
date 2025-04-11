/**
 * Handles voice input and determines the appropriate response.
 * @param {string} voiceInput - The user's voice input.
 * @param {Array} orderDetailsArray - Array of order details.
 * @param {Object} agent - The LangGraph agent for invoking LLM.
 * @param {Array} messages - The session messages array.
 * @returns {Promise<string>} - The assistant's response.
 */
async function handleVoiceInput(voiceInput, orderDetailsArray, agent, messages) {
    let assistantResponse = "I'm sorry, I couldn't process your request.";
  
    if (voiceInput.includes("order") || voiceInput.includes("product")) {
      if (orderDetailsArray.length === 0) {
        assistantResponse = "I don't have any order details for you at the moment.";
      } else if (voiceInput.includes("recent")) {
        const recentOrder = orderDetailsArray[orderDetailsArray.length - 1];
        assistantResponse = `Your most recent order is: ${recentOrder.product}, Quantity: ${recentOrder.quantity}, Status: ${recentOrder.status}, Ordered on: ${recentOrder.orderDate}.`;
      } else if (voiceInput.includes("status")) {
        let statusResponse = "Your order statuses:\n";
        orderDetailsArray.forEach((order) => {
          statusResponse += `Order ${order.orderNumber} - Status: ${order.status}\n`;
        });
        assistantResponse = statusResponse;
      } else if (voiceInput.includes("expected delivery") || voiceInput.includes("delivery date")) {
        let deliveryResponse = "The expected delivery dates for your orders:\n";
        orderDetailsArray.forEach((order) => {
          deliveryResponse += `${order.orderNumber} - Expected Delivery Date: ${order.expectedDeliveryDate || "Not available"}\n`;
        });
        assistantResponse = deliveryResponse;
      } else {
        let productList = "Here are the products you ordered:\n";
        orderDetailsArray.forEach((order) => {
          productList += `- ${order.product}\n`;
        });
        assistantResponse = productList;
      }
    } else {
      messages.push({
        role: "system",
        content: `Order details available: ${JSON.stringify(orderDetailsArray)}`,
      });
      const result = await agent.invoke({ messages });
      assistantResponse = result.messages[result.messages.length - 1].content;
    }
  
    return assistantResponse;
  }
  
  module.exports = { handleVoiceInput };