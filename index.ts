import OpenAI from 'openai'
import { Hono } from 'hono';
import { twiml } from 'twilio';
import { logger } from 'hono/logger';
import { serve } from '@hono/node-server';
import {getCookie, setCookie} from 'hono/cookie';

const app = new Hono()
const openAI = new OpenAI()
const GREETING_MESSAGE = 'Hello, how are you?'

app.use('*', logger())

app.post('/incoming-call', (c) =>{
    const voiceResponse = new twiml.VoiceResponse()

    //Stores the conversation in cookie, if no cookie means its a new conversation.
    if(!getCookie(c, "messages")) {
        voiceResponse.say(GREETING_MESSAGE)
        setCookie(c, "messages", JSON.stringify([
            {
                role: "system",
                content: `  You are a helpful phone assistant for Concret.io, a Salesforce consulting company.
                            The company operates between 10:00 AM and 07:00 PM.
                            You assist customers in creating Salesforce-based solutions.
                            You also provide IT companies with expert services to resolve their technical issues.
                            The company is located in Gurugram, India.`
            },
            {
                role : "assistant",
                content: GREETING_MESSAGE
            }
        ]))
    }

    voiceResponse.gather({
        input: ["speech"],
        speechTimeout: "auto",
        speechModel: "experimental_conversations",
        enhanced: true,
        action: '/respond'
    })

    c.header("Content-Type", "application/xml")
    return c.body(voiceResponse.toString())
})

app.post('/respond', async (c) => {
    const formData = await c.req.formData()
    const voiceInput = formData.get('SpeechResult')?.toString()!

    let messages = JSON.parse(getCookie(c, "messages")!)
    messages.push({role:"user", Content: voiceInput})

    //OpenAI
    const chatCompletion = await openAI.chat.completions.create({
        model: "gpt-3.5-turbo",
        messages,
        temperature: 0
    })

    const assistanceResponse = chatCompletion.choices[0].message.content
    messages.push({role: "assistant", content: assistanceResponse})
    console.log(messages)

    setCookie(c, "messages", JSON.stringify(messages))

    const voiceResponse = new twiml.VoiceResponse()
    voiceResponse.say(assistanceResponse!)         //GPT Response
    voiceResponse.redirect({method:"POST"},"/incoming-call")
    

    c.header("Content-Type", "application/xml")
    return c.body(voiceResponse.toString())
})


const port = 3000
console. log(`Server is running on port ${port}`)

serve({
fetch: app.fetch,
port
})