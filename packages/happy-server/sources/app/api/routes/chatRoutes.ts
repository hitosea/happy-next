import { Fastify } from "../types";
import { chatImageUpload } from "@/app/chat/chatImageUpload";
import { db } from "@/storage/db";
import { canSendMessages } from "@/app/share/accessControl";

export function chatRoutes(app: Fastify) {
    /**
     * Upload an image for a chat session.
     *
     * Expects multipart/form-data with:
     * - file: The image file (required)
     * - sessionId: The chat session ID (required)
     *
     * Returns the uploaded image URL and metadata including dimensions and thumbhash.
     */
    app.post("/v1/chat/upload-image", {
        preHandler: app.authenticate,
    }, async (request, reply) => {
        const userId = request.userId;

        // Parse multipart data using parts() iterator
        let fileBuffer: Buffer | null = null;
        let fileMimeType: string | null = null;
        let sessionId: string | null = null;

        for await (const part of request.parts()) {
            if (part.type === 'file') {
                if (part.fieldname === 'file') {
                    fileBuffer = await part.toBuffer();
                    fileMimeType = part.mimetype;
                }
            } else {
                if (part.fieldname === 'sessionId') {
                    sessionId = part.value as string;
                }
            }
        }

        if (!fileBuffer) {
            return reply.status(400).send({ error: "No file uploaded" });
        }

        if (!sessionId) {
            return reply.status(400).send({ error: "sessionId is required" });
        }

        // Verify the user can send messages to this session. The session may be
        // shared: a recipient with edit access must be able to attach images,
        // matching the gate on POST /v3/sessions/:sessionId/send. The image is
        // stored under the session owner's directory, not the uploader's.
        if (!await canSendMessages(userId, sessionId)) {
            return reply.status(404).send({ error: "Session not found" });
        }

        const session = await db.session.findUnique({
            where: { id: sessionId },
            select: { accountId: true },
        });
        if (!session) {
            return reply.status(404).send({ error: "Session not found" });
        }

        // Validate mime type
        const mimeType = fileMimeType || "image/jpeg";
        if (mimeType !== "image/jpeg" && mimeType !== "image/png") {
            return reply.status(400).send({ error: "Only JPEG and PNG images are supported" });
        }

        // Upload image (owner directory + attribution)
        const result = await chatImageUpload(session.accountId, sessionId, fileBuffer, mimeType);

        return reply.send({
            success: true,
            data: result,
        });
    });
}
