import Anthropic from "@anthropic-ai/sdk";
import type { Express, Request, Response } from "express";
import { db } from "./db";
import { z } from "zod";
import { 
  conversations, messages, employeeLocations, clientLocations, 
  capacityAnalyses, weeklySchedules, branches 
} from "@shared/schema";
import { eq, desc, and, isNull } from "drizzle-orm";
import { logger } from "./logger";

const anthropic = new Anthropic({
  apiKey: process.env.AI_INTEGRATIONS_ANTHROPIC_API_KEY,
  baseURL: process.env.AI_INTEGRATIONS_ANTHROPIC_BASE_URL,
});

const createConversationSchema = z.object({
  title: z.string().min(1).max(200).default("New Chat"),
  branchId: z.string().nullable().optional(),
});

const sendMessageSchema = z.object({
  content: z.string().min(1).max(10000),
  branchId: z.string().nullable().optional(),
});

function sanitizeText(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;');
}

async function gatherBranchContext(branchId: string): Promise<string> {
  try {
    const [branchInfo] = await db.select().from(branches).where(eq(branches.id, branchId));
    const branchName = branchInfo?.displayName || branchInfo?.name || "Unknown Branch";

    const employees = await db.select().from(employeeLocations).where(eq(employeeLocations.branchId, branchId));
    
    const clients = await db.select().from(clientLocations).where(eq(clientLocations.branchId, branchId));

    const [latestAnalysis] = await db.select().from(capacityAnalyses)
      .where(eq(capacityAnalyses.branchId, branchId))
      .orderBy(desc(capacityAnalyses.uploadedAt))
      .limit(1);

    const [latestSchedule] = await db.select().from(weeklySchedules)
      .where(eq(weeklySchedules.branchId, branchId))
      .orderBy(desc(weeklySchedules.generatedAt))
      .limit(1);

    let context = `\n## Current Branch: ${branchName}\n`;

    if (employees.length > 0) {
      context += `\n### Staff (${employees.length} employees)\n`;
      context += `| Name | Postcode | Transport | Gender |\n|------|----------|-----------|--------|\n`;
      for (const emp of employees) {
        context += `| ${emp.employeeName} | ${emp.homePostcode} | ${emp.transportMode || 'car'} | ${emp.gender || 'unknown'} |\n`;
      }
    }

    if (clients.length > 0) {
      context += `\n### Clients (${clients.length} clients)\n`;
      context += `| Name | Postcode | Address |\n|------|----------|---------|\n`;
      for (const cl of clients) {
        context += `| ${cl.clientName} | ${cl.postcode} | ${cl.addressLine} |\n`;
      }
    }

    if (latestAnalysis) {
      const kpis = latestAnalysis.kpis as any;
      context += `\n### Latest Capacity Analysis (Week: ${latestAnalysis.weekStartDate} to ${latestAnalysis.weekEndDate})\n`;
      if (kpis) {
        context += `- Net Capacity: ${kpis.netCapacitySum || 0} hours\n`;
        context += `- Client Required: ${kpis.clientRequiredSum || 0} hours\n`;
        context += `- Capacity Gap: ${kpis.gapSum || 0} hours\n`;
        context += `- Unavailability: ${kpis.unavailabilitySum || 0} hours\n`;
        context += `- Holidays: ${kpis.holidaysSum || 0} hours\n`;
      }

      const dailySummary = latestAnalysis.dailySummary as any[];
      if (dailySummary && Array.isArray(dailySummary)) {
        context += `\n#### Daily Summary\n`;
        context += `| Date | Net Capacity | Client Required | Gap | Status |\n|------|-------------|-----------------|-----|--------|\n`;
        for (const day of dailySummary) {
          context += `| ${day.date} | ${day.netCapacity}h | ${day.clientRequired}h | ${day.gap}h | ${day.status} |\n`;
        }
      }

      const employeesByDate = latestAnalysis.employeesByDate as Record<string, any[]>;
      if (employeesByDate && typeof employeesByDate === 'object') {
        context += `\n#### Employee Availability by Date\n`;
        for (const [date, emps] of Object.entries(employeesByDate)) {
          if (!Array.isArray(emps)) continue;
          const available = emps.filter((e: any) => e.status === 'Available' || e.status === 'Partially Available');
          context += `\n**${date}** - ${available.length}/${emps.length} available\n`;
          for (const emp of available) {
            context += `- ${emp.employeeName}: ${emp.status}, Windows: ${emp.timeWindows || 'Full day'}, ${emp.hours || 0}h capacity`;
            if (emp.gender) context += `, Gender: ${emp.gender}`;
            context += `\n`;
          }
        }
      }
    }

    if (latestSchedule) {
      const metrics = latestSchedule.metrics as any;
      context += `\n### Latest Schedule (Week: ${latestSchedule.weekStartDate})\n`;
      if (metrics) {
        context += `- Visits Assigned: ${metrics.totalVisitsAssigned || 0}\n`;
        context += `- Visits Unallocated: ${metrics.totalVisitsUnallocated || 0}\n`;
        context += `- Employees Utilized: ${metrics.employeesUtilized || 0}\n`;
        context += `- Avg Travel Time: ${metrics.averageTravelTimePerVisit || 0} min\n`;
      }
    }

    return context;
  } catch (error) {
    logger.error("Error gathering branch context:", error);
    return "\n[Error loading branch data - some context may be missing]\n";
  }
}

function getBranchFilter(branchId: string | null | undefined) {
  if (branchId) {
    return eq(conversations.branchId, branchId);
  }
  return isNull(conversations.branchId);
}

const SYSTEM_PROMPT = `You are Care Capacity AI, an intelligent assistant embedded in a care workforce management dashboard. You help care home scheduling teams and business development staff with:

1. **Care Query Matching**: When a new care enquiry comes in, you match available employees to the client based on:
   - Time window availability (from the BD Matrix / employee schedules)
   - Postcode proximity and travel constraints (35 km/h car speed, 1.2x road factor, 15 km/h + 15 min overhead for walkers/public transport)
   - Gender preferences (some clients require female carers)
   - Weekly contracted hours (GH employees have guaranteed hours targets)
   - Transport mode (car vs walker/public transport affects travel range)
   - 45-minute maximum travel cap on all legs

2. **Dashboard Insights**: You can analyze the capacity data to provide:
   - Staffing gap analysis and recommendations
   - Identifying underutilized employees
   - Spotting scheduling patterns and inefficiencies
   - Predicting capacity shortfalls
   - Business development opportunities based on available capacity

3. **Travel Estimation**: You can estimate travel times between postcodes using the formula:
   - Haversine distance × 1.2 road factor
   - Car: 35 km/h average, minimum 5 min
   - Walker/Public: 15 km/h, +15 min overhead, minimum 15 min
   - Peak congestion: Morning (07:00-09:30) ×1.3, Evening (15:30-18:30) ×1.25

**Important Rules:**
- Always be specific with names, dates, and times when recommending staff
- Flag any gender requirement mismatches clearly
- Consider travel time realistically - walkers/public transport have much shorter range
- Prioritize GH (Guaranteed Hours) employees who are underutilized
- Note if an employee is already at or over their weekly hours
- Keep responses concise and actionable
- Use simple language suitable for non-technical care home staff
- Format responses with clear sections and bullet points for readability`;

export function registerAIRoutes(app: Express): void {
  app.get("/api/ai/conversations", async (req: Request, res: Response) => {
    try {
      const branchId = req.query.branchId as string | undefined;
      const filter = getBranchFilter(branchId || null);
      const allConversations = await db.select().from(conversations)
        .where(filter)
        .orderBy(desc(conversations.createdAt));
      res.json(allConversations);
    } catch (error) {
      logger.error("Error fetching conversations:", error);
      res.status(500).json({ error: "Failed to fetch conversations" });
    }
  });

  app.get("/api/ai/conversations/:id", async (req: Request, res: Response) => {
    try {
      const id = parseInt(req.params.id);
      if (isNaN(id)) return res.status(400).json({ error: "Invalid conversation ID" });
      
      const [conversation] = await db.select().from(conversations).where(eq(conversations.id, id));
      if (!conversation) {
        return res.status(404).json({ error: "Conversation not found" });
      }
      const msgs = await db.select().from(messages).where(eq(messages.conversationId, id)).orderBy(messages.createdAt);
      res.json({ ...conversation, messages: msgs });
    } catch (error) {
      logger.error("Error fetching conversation:", error);
      res.status(500).json({ error: "Failed to fetch conversation" });
    }
  });

  app.post("/api/ai/conversations", async (req: Request, res: Response) => {
    try {
      const parsed = createConversationSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: "Invalid input", details: parsed.error.issues });
      }
      const { title, branchId } = parsed.data;
      const [conversation] = await db.insert(conversations).values({ 
        title,
        branchId: branchId || null 
      }).returning();
      res.status(201).json(conversation);
    } catch (error) {
      logger.error("Error creating conversation:", error);
      res.status(500).json({ error: "Failed to create conversation" });
    }
  });

  app.delete("/api/ai/conversations/:id", async (req: Request, res: Response) => {
    try {
      const id = parseInt(req.params.id);
      if (isNaN(id)) return res.status(400).json({ error: "Invalid conversation ID" });
      
      const [conversation] = await db.select().from(conversations).where(eq(conversations.id, id));
      if (!conversation) {
        return res.status(404).json({ error: "Conversation not found" });
      }
      
      await db.delete(messages).where(eq(messages.conversationId, id));
      await db.delete(conversations).where(eq(conversations.id, id));
      res.status(204).send();
    } catch (error) {
      logger.error("Error deleting conversation:", error);
      res.status(500).json({ error: "Failed to delete conversation" });
    }
  });

  app.post("/api/ai/conversations/:id/messages", async (req: Request, res: Response) => {
    try {
      const conversationId = parseInt(req.params.id);
      if (isNaN(conversationId)) return res.status(400).json({ error: "Invalid conversation ID" });

      const parsed = sendMessageSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: "Invalid input", details: parsed.error.issues });
      }
      const { content, branchId } = parsed.data;

      const [conversation] = await db.select().from(conversations).where(eq(conversations.id, conversationId));
      if (!conversation) {
        return res.status(404).json({ error: "Conversation not found" });
      }

      const sanitizedContent = sanitizeText(content);
      await db.insert(messages).values({ conversationId, role: "user", content: sanitizedContent });

      const existingMessages = await db.select().from(messages)
        .where(eq(messages.conversationId, conversationId))
        .orderBy(messages.createdAt);

      const chatMessages = existingMessages.map((m) => ({
        role: m.role as "user" | "assistant",
        content: m.content,
      }));

      const effectiveBranchId = branchId || conversation.branchId;
      let branchContext = "";
      if (effectiveBranchId) {
        branchContext = await gatherBranchContext(effectiveBranchId);
      }

      const fullSystemPrompt = SYSTEM_PROMPT + (branchContext ? `\n\n## CURRENT DASHBOARD DATA\n${branchContext}` : "");

      res.setHeader("Content-Type", "text/event-stream");
      res.setHeader("Cache-Control", "no-cache");
      res.setHeader("Connection", "keep-alive");

      const stream = anthropic.messages.stream({
        model: "claude-sonnet-4-5",
        max_tokens: 4096,
        system: fullSystemPrompt,
        messages: chatMessages,
      });

      let fullResponse = "";

      for await (const event of stream) {
        if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
          const text = event.delta.text;
          if (text) {
            fullResponse += text;
            res.write(`data: ${JSON.stringify({ content: text })}\n\n`);
          }
        }
      }

      await db.insert(messages).values({ conversationId, role: "assistant", content: fullResponse });

      res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
      res.end();
    } catch (error) {
      logger.error("Error in AI chat:", error);
      if (res.headersSent) {
        res.write(`data: ${JSON.stringify({ error: "AI processing failed. Please try again." })}\n\n`);
        res.end();
      } else {
        res.status(500).json({ error: "Failed to process message" });
      }
    }
  });
}
