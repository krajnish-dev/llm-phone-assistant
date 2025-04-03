// lib/createCase.js
const axios = require('axios');
const { StructuredTool } = require('@langchain/core/tools');
const { z } = require('zod');
const dotenv = require('dotenv');
dotenv.config();

const SF_ACCESS_TOKEN = process.env.SF_ACCESS_TOKEN;
const BASE_URL = "https://concretio-rajnish-dev-ed.develop.my.salesforce.com/services/apexrest/CaseStatus/";

class CreateCaseTool extends StructuredTool {
    name = "create_case";
    description = "Create a new case in Salesforce";
    schema = z.object({
        caseDetails: z.object({
            subject: z.string().describe("Subject of the case"),
            description: z.string().describe("Detailed description of the issue"),
            origin: z.string().describe("Source of case creation Phone"),
            contactName: z.string().describe("Name of the contact"),
            contactEmail: z.string().describe("Email of the contact"),
        }).describe("Case details object containing subject, description, origin, contactName, and contactEmail"),
    });

    async _call({ caseDetails }) {
        try {
            const headers = {
                "Authorization": `Bearer ${SF_ACCESS_TOKEN}`,
                "Content-Type": "application/json",
            };
            console.log("🔍 Creating Case with body:", JSON.stringify(caseDetails, null, 2));
            const response = await axios.post(BASE_URL, caseDetails, { headers });
            console.log("🔍 Case Created:", JSON.stringify(response.data, null, 2));
            return `Case created successfully: ${JSON.stringify(response.data, null, 2)}`;
        } catch (error) {
            console.error("🔍 Error creating case:", error.response?.data || error.message);
            return `Error creating case: ${error.response?.data || error.message}`;
        }
    }
}

module.exports = { CreateCaseTool };
