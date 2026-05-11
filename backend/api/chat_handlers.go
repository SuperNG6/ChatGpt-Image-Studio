package api

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"

	"chatgpt2api/handler"
	"chatgpt2api/internal/accounts"
)

type chatAttachmentPayload struct {
	Kind     string `json:"kind"`
	Name     string `json:"name"`
	MIMEType string `json:"mimeType"`
	DataURL  string `json:"dataUrl,omitempty"`
	Text     string `json:"text,omitempty"`
}

type createChatMessageRequest struct {
	Message          string                  `json:"message"`
	Model            string                  `json:"model,omitempty"`
	ConversationID   string                  `json:"conversationId,omitempty"`
	ParentMessageID  string                  `json:"parentMessageId,omitempty"`
	Attachments      []chatAttachmentPayload `json:"attachments,omitempty"`
}

type createChatMessageResponse struct {
	Message         string `json:"message"`
	ConversationID  string `json:"conversationId,omitempty"`
	ParentMessageID string `json:"parentMessageId,omitempty"`
	SourceAccountID string `json:"sourceAccountId,omitempty"`
}

type chatConversationDocument map[string]any

type chatConversationListResponse struct {
	Items []chatConversationDocument `json:"items"`
}

type chatConversationItemResponse struct {
	Item chatConversationDocument `json:"item"`
}

func (s *Server) handleCreateChatMessage(w http.ResponseWriter, r *http.Request) {
	var body createChatMessageRequest
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]any{"error": "invalid request body"})
		return
	}

	prompt, imageFiles, err := buildChatPromptAndImages(body)
	if err != nil {
		writeAPIError(w, http.StatusBadRequest, "invalid_chat_message", err.Error())
		return
	}

	auth, account, release, err := s.getStore().AcquireImageAuthLeaseFilteredWithDisabledOption(nil, nil, false)
	if err != nil {
		if strings.Contains(err.Error(), accounts.ErrNoAvailableImageAuth.Error()) {
			writeAPIError(w, http.StatusBadGateway, "no_available_chat_account", "当前没有可用账号用于对话")
			return
		}
		writeJSON(w, http.StatusBadGateway, map[string]any{"error": err.Error()})
		return
	}
	if release != nil {
		defer release()
	}

	timeout := time.Duration(max(30, s.cfg.ChatGPT.SSETimeout)) * time.Second
	ctx, cancel := context.WithTimeout(r.Context(), timeout)
	defer cancel()

	client := handler.NewChatGPTClientWithProxyAndConfig(
		auth.AccessToken,
		firstNonEmpty(stringValue(auth.Data["cookies"]), stringValue(auth.Data["cookie"])),
		s.cfg.ChatGPTProxyURL(),
		s.imageRequestConfig(),
	)
	model := strings.TrimSpace(body.Model)
	if model == "" {
		model = firstNonEmpty(account.DefaultModelSlug, s.cfg.ChatGPT.PaidImageModel, "gpt-5.4-mini")
	}
	result, err := client.SendMessage(
		ctx,
		prompt,
		model,
		body.ConversationID,
		body.ParentMessageID,
		imageFiles,
	)
	if err != nil {
		writeJSON(w, http.StatusBadGateway, map[string]any{"error": err.Error()})
		return
	}

	writeJSON(w, http.StatusOK, createChatMessageResponse{
		Message:         result.Content,
		ConversationID:  result.ConversationID,
		ParentMessageID: result.ParentMessageID,
		SourceAccountID: account.ID,
	})
}

func (s *Server) handleListChatConversations(w http.ResponseWriter, r *http.Request) {
	items, err := s.listChatConversationDocuments()
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]any{"error": err.Error()})
		return
	}
	writeJSON(w, http.StatusOK, chatConversationListResponse{Items: items})
}

func (s *Server) handleGetChatConversation(w http.ResponseWriter, r *http.Request) {
	id := cleanChatConversationID(r.PathValue("id"))
	if id == "" {
		writeAPIError(w, http.StatusBadRequest, "invalid_chat_conversation_id", "对话 ID 不能为空")
		return
	}
	item, err := s.readChatConversationDocument(id)
	if err != nil {
		if os.IsNotExist(err) {
			writeAPIError(w, http.StatusNotFound, "chat_conversation_not_found", "对话不存在")
			return
		}
		writeJSON(w, http.StatusInternalServerError, map[string]any{"error": err.Error()})
		return
	}
	writeJSON(w, http.StatusOK, chatConversationItemResponse{Item: item})
}

func (s *Server) handleSaveChatConversation(w http.ResponseWriter, r *http.Request) {
	id := cleanChatConversationID(r.PathValue("id"))
	if id == "" {
		writeAPIError(w, http.StatusBadRequest, "invalid_chat_conversation_id", "对话 ID 不能为空")
		return
	}
	var item chatConversationDocument
	if err := json.NewDecoder(r.Body).Decode(&item); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]any{"error": "invalid request body"})
		return
	}
	item["id"] = id
	if stringValue(item["createdAt"]) == "" {
		item["createdAt"] = time.Now().UTC().Format(time.RFC3339Nano)
	}
	item["updatedAt"] = firstNonEmpty(stringValue(item["updatedAt"]), time.Now().UTC().Format(time.RFC3339Nano))
	if err := s.writeChatConversationDocument(id, item); err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]any{"error": err.Error()})
		return
	}
	writeJSON(w, http.StatusOK, chatConversationItemResponse{Item: item})
}

func (s *Server) handleDeleteChatConversation(w http.ResponseWriter, r *http.Request) {
	id := cleanChatConversationID(r.PathValue("id"))
	if id == "" {
		writeAPIError(w, http.StatusBadRequest, "invalid_chat_conversation_id", "对话 ID 不能为空")
		return
	}
	if err := os.Remove(s.chatConversationFilePath(id)); err != nil && !os.IsNotExist(err) {
		writeJSON(w, http.StatusInternalServerError, map[string]any{"error": err.Error()})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

func (s *Server) chatConversationDir() string {
	return filepath.Join(s.cfg.Paths().Root, "data", "chat_history")
}

func (s *Server) chatConversationFilePath(id string) string {
	return filepath.Join(s.chatConversationDir(), cleanChatConversationID(id)+".json")
}

func cleanChatConversationID(value string) string {
	id := strings.TrimSpace(filepath.Base(value))
	id = strings.TrimSuffix(id, ".json")
	if id == "." || id == string(filepath.Separator) {
		return ""
	}
	return id
}

func (s *Server) listChatConversationDocuments() ([]chatConversationDocument, error) {
	dir := s.chatConversationDir()
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return nil, err
	}
	entries, err := os.ReadDir(dir)
	if err != nil {
		return nil, err
	}
	items := make([]chatConversationDocument, 0, len(entries))
	for _, entry := range entries {
		if entry.IsDir() || !strings.HasSuffix(strings.ToLower(entry.Name()), ".json") {
			continue
		}
		id := cleanChatConversationID(entry.Name())
		item, err := s.readChatConversationDocument(id)
		if err != nil {
			continue
		}
		items = append(items, item)
	}
	sort.SliceStable(items, func(i, j int) bool {
		return stringValue(items[i]["updatedAt"]) > stringValue(items[j]["updatedAt"])
	})
	return items, nil
}

func (s *Server) readChatConversationDocument(id string) (chatConversationDocument, error) {
	raw, err := os.ReadFile(s.chatConversationFilePath(id))
	if err != nil {
		return nil, err
	}
	item := chatConversationDocument{}
	if err := json.Unmarshal(raw, &item); err != nil {
		return nil, err
	}
	if item == nil {
		item = chatConversationDocument{}
	}
	item["id"] = id
	return item, nil
}

func (s *Server) writeChatConversationDocument(id string, item chatConversationDocument) error {
	dir := s.chatConversationDir()
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return err
	}
	raw, err := json.MarshalIndent(item, "", "  ")
	if err != nil {
		return err
	}
	tmpPath := s.chatConversationFilePath(id) + ".tmp"
	if err := os.WriteFile(tmpPath, raw, 0o644); err != nil {
		return err
	}
	return os.Rename(tmpPath, s.chatConversationFilePath(id))
}

func buildChatPromptAndImages(body createChatMessageRequest) (string, [][]byte, error) {
	parts := []string{strings.TrimSpace(body.Message)}
	images := make([][]byte, 0)
	for _, attachment := range body.Attachments {
		switch strings.ToLower(strings.TrimSpace(attachment.Kind)) {
		case "image":
			if strings.TrimSpace(attachment.DataURL) == "" {
				continue
			}
			data, err := decodeTaskDataURL(attachment.DataURL)
			if err != nil {
				return "", nil, fmt.Errorf("读取图片 %s 失败：%w", attachment.Name, err)
			}
			images = append(images, data)
		case "document":
			name := firstNonEmpty(strings.TrimSpace(attachment.Name), "未命名文档")
			text := strings.TrimSpace(attachment.Text)
			if text == "" {
				parts = append(parts, fmt.Sprintf("用户上传了文档《%s》，但当前只能读取文件名，请结合用户描述继续对话。", name))
				continue
			}
			if len(text) > 12000 {
				text = text[:12000]
			}
			parts = append(parts, fmt.Sprintf("用户上传的文档《%s》内容如下：\n%s", name, text))
		}
	}
	prompt := strings.TrimSpace(strings.Join(nonEmptyStrings(parts), "\n\n"))
	if prompt == "" && len(images) == 0 {
		return "", nil, fmt.Errorf("消息内容不能为空")
	}
	if prompt == "" {
		prompt = "请根据用户上传的图片继续对话，分析图片内容并询问下一步创作目标。"
	}
	return prompt, images, nil
}

func nonEmptyStrings(values []string) []string {
	result := make([]string, 0, len(values))
	for _, value := range values {
		if strings.TrimSpace(value) != "" {
			result = append(result, strings.TrimSpace(value))
		}
	}
	return result
}
