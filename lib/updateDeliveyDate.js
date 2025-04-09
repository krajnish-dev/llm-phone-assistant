const axios = require('axios');
const { StructuredTool } = require('@langchain/core/tools');
const { z } = require('zod');
const dotenv = require('dotenv');
dotenv.config();

const SF_ACCESS_TOKEN = process.env.SF_ACCESS_TOKEN;
const BASE_URL = "https://concretio-rajnish-dev-ed.develop.my.salesforce.com/services/apexrest/updateExpectedDeliveryDate";

class UpdateDeliveryDateTool extends StructuredTool {
    name = "update_delivery_date";
    description = "Update the expected delivery date of an order in Salesforce";
    schema = z.object({
        expectedDeliveryDate: z.string().describe("The new expected delivery date in YYYY-MM-DD format"),
    });

    async _call({expectedDeliveryDate }) {
        try {
            const headers = {
                "Authorization": `Bearer ${SF_ACCESS_TOKEN}`,
                "Content-Type": "application/json",
            };

            const payload = {
                expectedDeliveryDate
            };

            console.log("📦 Updating Delivery Date:", JSON.stringify(payload, null, 2));

            const response = await axios.post(BASE_URL, payload, { headers });

            console.log("✅ Delivery Date Updated:", JSON.stringify(response.data, null, 2));
            return `Delivery date updated successfully: ${JSON.stringify(response.data, null, 2)}`;
        } catch (error) {
            console.error("❌ Error updating delivery date:", error.response?.data || error.message);
            return `Error updating delivery date: ${error.response?.data || error.message}`;
        }
    }
}

module.exports = { UpdateDeliveryDateTool };
