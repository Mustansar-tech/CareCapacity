import { useState, useRef, useEffect, useCallback } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { 
  MessageSquare, Send, Plus, Trash2, Bot, User, Loader2, Sparkles
} from "lucide-react";
import { useBranch } from "@/contexts/BranchContext";
import type { Conversation, Message } from "@shared/schema";

interface ConversationWithMessages extends Conversation {
  messages: Message[];
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;');
}

function formatMarkdown(text: string): string {
  let html = escapeHtml(text);
  html = html
    .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.*?)\*/g, '<em>$1</em>')
    .replace(/^### (.*$)/gm, '<h4 class="font-semibold text-sm mt-3 mb-1">$1</h4>')
    .replace(/^## (.*$)/gm, '<h3 class="font-semibold text-base mt-4 mb-2">$1</h3>')
    .replace(/^# (.*$)/gm, '<h2 class="font-bold text-lg mt-4 mb-2">$1</h2>')
    .replace(/^- (.*$)/gm, '<li class="ml-4 list-disc">$1</li>')
    .replace(/^(\d+)\. (.*$)/gm, '<li class="ml-4 list-decimal">$1. $2</li>')
    .replace(/`([^`]+)`/g, '<code class="bg-gray-200 dark:bg-gray-700 px-1 rounded text-sm">$1</code>');
  
  html = html.replace(/\n/g, '<br/>');
  return html;
}

export function AIChat() {
  const { currentBranchId } = useBranch();
  const [activeConversationId, setActiveConversationId] = useState<number | null>(null);
  const [inputMessage, setInputMessage] = useState("");
  const [streamingContent, setStreamingContent] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const branchQuery = currentBranchId ? `?branchId=${currentBranchId}` : '';
  const { data: conversationsList = [] } = useQuery<Conversation[]>({
    queryKey: ['/api/ai/conversations', currentBranchId],
    queryFn: async () => {
      const res = await fetch(`/api/ai/conversations${branchQuery}`);
      if (!res.ok) throw new Error("Failed to fetch conversations");
      return res.json();
    },
  });

  const { data: activeConversation } = useQuery<ConversationWithMessages>({
    queryKey: ['/api/ai/conversations', activeConversationId],
    enabled: !!activeConversationId,
  });

  const createConversation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/ai/conversations", { 
        title: "New Chat", 
        branchId: currentBranchId 
      });
      return res.json();
    },
    onSuccess: (data: Conversation) => {
      queryClient.invalidateQueries({ queryKey: ['/api/ai/conversations', currentBranchId] });
      setActiveConversationId(data.id);
    },
  });

  const deleteConversation = useMutation({
    mutationFn: async (id: number) => {
      await apiRequest("DELETE", `/api/ai/conversations/${id}`);
    },
    onSuccess: (_data, deletedId) => {
      queryClient.invalidateQueries({ queryKey: ['/api/ai/conversations', currentBranchId] });
      if (activeConversationId === deletedId) {
        setActiveConversationId(null);
      }
    },
  });

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [activeConversation?.messages, streamingContent, scrollToBottom]);

  const sendMessage = useCallback(async () => {
    if (!inputMessage.trim() || !activeConversationId || isStreaming) return;
    
    const message = inputMessage.trim();
    setInputMessage("");
    setIsStreaming(true);
    setStreamingContent("");

    queryClient.setQueryData<ConversationWithMessages>(
      ['/api/ai/conversations', activeConversationId],
      (old) => {
        if (!old) return old;
        return {
          ...old,
          messages: [...old.messages, {
            id: Date.now(),
            conversationId: activeConversationId,
            role: "user",
            content: message,
            createdAt: new Date(),
          }]
        };
      }
    );

    try {
      const response = await fetch(`/api/ai/conversations/${activeConversationId}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: message, branchId: currentBranchId }),
      });

      if (!response.ok) throw new Error("Failed to send message");

      const reader = response.body?.getReader();
      const decoder = new TextDecoder();
      let accumulated = "";

      if (reader) {
        let buffer = "";
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const parts = buffer.split("\n\n");
          buffer = parts.pop() || "";

          for (const part of parts) {
            const line = part.trim();
            if (!line.startsWith("data: ")) continue;
            try {
              const data = JSON.parse(line.slice(6));
              if (data.content) {
                accumulated += data.content;
                setStreamingContent(accumulated);
              }
              if (data.done) {
                setStreamingContent("");
                setIsStreaming(false);
                queryClient.invalidateQueries({ queryKey: ['/api/ai/conversations', activeConversationId] });
                queryClient.invalidateQueries({ queryKey: ['/api/ai/conversations', currentBranchId] });
              }
              if (data.error) {
                setStreamingContent("");
                setIsStreaming(false);
              }
            } catch {}
          }
        }
      }
    } catch (error) {
      setStreamingContent("");
      setIsStreaming(false);
    }
  }, [inputMessage, activeConversationId, isStreaming, currentBranchId]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  }, [sendMessage]);

  const displayMessages = activeConversation?.messages || [];

  return (
    <div className="flex h-[calc(100vh-220px)] gap-4">
      <div className="w-64 flex-shrink-0">
        <Card className="glass h-full flex flex-col">
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm font-medium flex items-center gap-2">
                <MessageSquare className="w-4 h-4" />
                Chats
              </CardTitle>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => createConversation.mutate()}
                disabled={createConversation.isPending}
                className="h-7 w-7 p-0"
              >
                <Plus className="w-4 h-4" />
              </Button>
            </div>
          </CardHeader>
          <CardContent className="flex-1 overflow-hidden p-2">
            <ScrollArea className="h-full">
              <div className="space-y-1">
                {conversationsList.map((conv) => (
                  <div
                    key={conv.id}
                    className={`group flex items-center justify-between rounded-lg px-3 py-2 text-sm cursor-pointer transition-colors ${
                      activeConversationId === conv.id
                        ? "bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300"
                        : "hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-700 dark:text-gray-300"
                    }`}
                    onClick={() => setActiveConversationId(conv.id)}
                  >
                    <span className="truncate flex-1">{conv.title}</span>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-6 w-6 p-0 opacity-0 group-hover:opacity-100 transition-opacity"
                      onClick={(e) => {
                        e.stopPropagation();
                        deleteConversation.mutate(conv.id);
                      }}
                    >
                      <Trash2 className="w-3 h-3 text-red-500" />
                    </Button>
                  </div>
                ))}
                {conversationsList.length === 0 && (
                  <div className="text-center py-8 text-gray-400 dark:text-gray-500 text-xs">
                    No conversations yet.
                    <br />Click + to start a new chat.
                  </div>
                )}
              </div>
            </ScrollArea>
          </CardContent>
        </Card>
      </div>

      <Card className="glass flex-1 flex flex-col">
        <CardHeader className="pb-3 gradient-card dark:gradient-card-dark rounded-t-lg">
          <CardTitle className="flex items-center gap-3 text-base">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-r from-violet-500 to-blue-500 flex items-center justify-center">
              <Sparkles className="w-5 h-5 text-white" />
            </div>
            <span className="bg-gradient-to-r from-violet-600 to-blue-600 bg-clip-text text-transparent">
              Care Capacity AI Assistant
            </span>
            {currentBranchId && (
              <Badge variant="secondary" className="ml-auto text-xs">
                Connected to branch data
              </Badge>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent className="flex-1 flex flex-col overflow-hidden p-0">
          {!activeConversationId ? (
            <div className="flex-1 flex flex-col items-center justify-center text-gray-400 dark:text-gray-500 gap-4 p-8">
              <div className="w-16 h-16 rounded-full bg-gradient-to-r from-violet-500/20 to-blue-500/20 flex items-center justify-center">
                <Bot className="w-8 h-8 text-violet-500" />
              </div>
              <div className="text-center max-w-md">
                <p className="text-lg font-medium text-gray-600 dark:text-gray-400 mb-2">Care Capacity AI</p>
                <p className="text-sm mb-4">
                  Ask me about staff availability, match care enquiries to employees, 
                  analyze capacity gaps, or get insights from your dashboard data.
                </p>
                <div className="grid grid-cols-1 gap-2 text-xs text-left">
                  <div className="bg-gray-50 dark:bg-gray-800 rounded-lg p-3 border border-gray-200 dark:border-gray-700">
                    "We have a new client in FK1 3AA needing female carer, Mon-Fri 09:00-10:00. Who's available?"
                  </div>
                  <div className="bg-gray-50 dark:bg-gray-800 rounded-lg p-3 border border-gray-200 dark:border-gray-700">
                    "Which GH employees are underutilized this week?"
                  </div>
                  <div className="bg-gray-50 dark:bg-gray-800 rounded-lg p-3 border border-gray-200 dark:border-gray-700">
                    "Summarize today's capacity - do we have any gaps?"
                  </div>
                </div>
              </div>
              <Button
                onClick={() => createConversation.mutate()}
                disabled={createConversation.isPending}
                className="mt-4 bg-gradient-to-r from-violet-500 to-blue-500 text-white"
              >
                <Plus className="w-4 h-4 mr-2" />
                Start New Chat
              </Button>
            </div>
          ) : (
            <>
              <ScrollArea className="flex-1 p-4">
                <div className="space-y-4 max-w-3xl mx-auto">
                  {displayMessages.map((msg) => (
                    <div
                      key={msg.id}
                      className={`flex gap-3 ${msg.role === "user" ? "justify-end" : "justify-start"}`}
                    >
                      {msg.role === "assistant" && (
                        <div className="w-7 h-7 rounded-full bg-gradient-to-r from-violet-500 to-blue-500 flex items-center justify-center flex-shrink-0 mt-1">
                          <Bot className="w-4 h-4 text-white" />
                        </div>
                      )}
                      <div
                        className={`max-w-[80%] rounded-xl px-4 py-3 text-sm leading-relaxed ${
                          msg.role === "user"
                            ? "bg-blue-600 text-white rounded-br-sm"
                            : "bg-gray-100 dark:bg-gray-800 text-gray-800 dark:text-gray-200 rounded-bl-sm"
                        }`}
                      >
                        {msg.role === "assistant" ? (
                          <div 
                            className="prose prose-sm dark:prose-invert max-w-none [&_li]:my-0.5 [&_h2]:text-base [&_h3]:text-sm [&_h4]:text-sm"
                            dangerouslySetInnerHTML={{ __html: formatMarkdown(msg.content) }} 
                          />
                        ) : (
                          msg.content
                        )}
                      </div>
                      {msg.role === "user" && (
                        <div className="w-7 h-7 rounded-full bg-blue-600 flex items-center justify-center flex-shrink-0 mt-1">
                          <User className="w-4 h-4 text-white" />
                        </div>
                      )}
                    </div>
                  ))}

                  {streamingContent && (
                    <div className="flex gap-3 justify-start">
                      <div className="w-7 h-7 rounded-full bg-gradient-to-r from-violet-500 to-blue-500 flex items-center justify-center flex-shrink-0 mt-1">
                        <Bot className="w-4 h-4 text-white" />
                      </div>
                      <div className="max-w-[80%] rounded-xl rounded-bl-sm px-4 py-3 text-sm leading-relaxed bg-gray-100 dark:bg-gray-800 text-gray-800 dark:text-gray-200">
                        <div 
                          className="prose prose-sm dark:prose-invert max-w-none [&_li]:my-0.5 [&_h2]:text-base [&_h3]:text-sm [&_h4]:text-sm"
                          dangerouslySetInnerHTML={{ __html: formatMarkdown(streamingContent) }} 
                        />
                        <span className="inline-block w-1.5 h-4 bg-violet-500 animate-pulse ml-0.5 align-text-bottom" />
                      </div>
                    </div>
                  )}

                  {isStreaming && !streamingContent && (
                    <div className="flex gap-3 justify-start">
                      <div className="w-7 h-7 rounded-full bg-gradient-to-r from-violet-500 to-blue-500 flex items-center justify-center flex-shrink-0">
                        <Bot className="w-4 h-4 text-white" />
                      </div>
                      <div className="rounded-xl rounded-bl-sm px-4 py-3 bg-gray-100 dark:bg-gray-800">
                        <Loader2 className="w-4 h-4 animate-spin text-violet-500" />
                      </div>
                    </div>
                  )}
                  <div ref={messagesEndRef} />
                </div>
              </ScrollArea>

              <div className="border-t border-gray-200 dark:border-gray-700 p-4">
                <div className="flex gap-2 max-w-3xl mx-auto">
                  <Input
                    ref={inputRef}
                    value={inputMessage}
                    onChange={(e) => setInputMessage(e.target.value)}
                    onKeyDown={handleKeyDown}
                    placeholder="Ask about staff availability, care queries, capacity insights..."
                    disabled={isStreaming}
                    className="flex-1"
                  />
                  <Button
                    onClick={sendMessage}
                    disabled={!inputMessage.trim() || isStreaming}
                    className="bg-gradient-to-r from-violet-500 to-blue-500 text-white px-4"
                  >
                    {isStreaming ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <Send className="w-4 h-4" />
                    )}
                  </Button>
                </div>
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
