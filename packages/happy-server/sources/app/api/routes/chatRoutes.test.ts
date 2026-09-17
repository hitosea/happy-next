import fastify from "fastify";
import { serializerCompiler, validatorCompiler } from "fastify-type-provider-zod";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Fastify } from "../types";

const {
    dbMock,
    canSendMessagesMock,
    chatImageUploadMock,
    resetState,
    seedSession,
} = vi.hoisted(() => {
    const state = {
        sessions: [] as { id: string; accountId: string }[],
    };

    const resetState = () => {
        state.sessions = [];
    };

    const seedSession = (id: string, accountId: string) => {
        state.sessions.push({ id, accountId });
    };

    const dbMock = {
        session: {
            findUnique: vi.fn(async (args: any) => {
                const id = args?.where?.id as string;
                const session = state.sessions.find((s) => s.id === id);
                return session ? { accountId: session.accountId } : null;
            }),
            // Mirrors the owner-only lookup the route used before share support.
            // Keeping it here makes the sharee tests fail if that gate returns.
            findFirst: vi.fn(async (args: any) => {
                const id = args?.where?.id as string;
                const accountId = args?.where?.accountId as string | undefined;
                const session = state.sessions.find((s) => s.id === id && (!accountId || s.accountId === accountId));
                return session ? { accountId: session.accountId } : null;
            }),
        },
    };

    return {
        canSendMessagesMock: vi.fn(async () => true),
        chatImageUploadMock: vi.fn(async (ownerId: string, sessionId: string, _buffer: Buffer, mimeType: string) => ({
            url: `https://cdn.test/public/users/${ownerId}/chat/${sessionId}/img.jpg`,
            path: `public/users/${ownerId}/chat/${sessionId}/img.jpg`,
            width: 10,
            height: 10,
            thumbhash: "thumb",
            mimeType,
        })),
        resetState,
        seedSession,
        dbMock,
    };
});

vi.mock("@/storage/db", () => ({ db: dbMock }));
vi.mock("@/app/share/accessControl", () => ({ canSendMessages: canSendMessagesMock }));
vi.mock("@/app/chat/chatImageUpload", () => ({ chatImageUpload: chatImageUploadMock }));

import { chatRoutes } from "./chatRoutes";

const BOUNDARY = "----happyTestBoundary";

function multipartPayload(options: {
    sessionId?: string;
    file?: { filename: string; contentType: string; data: Buffer } | null;
}) {
    const chunks: Buffer[] = [];
    if (options.sessionId !== undefined) {
        chunks.push(Buffer.from(
            `--${BOUNDARY}\r\nContent-Disposition: form-data; name="sessionId"\r\n\r\n${options.sessionId}\r\n`
        ));
    }
    if (options.file) {
        chunks.push(Buffer.from(
            `--${BOUNDARY}\r\nContent-Disposition: form-data; name="file"; filename="${options.file.filename}"\r\n` +
            `Content-Type: ${options.file.contentType}\r\n\r\n`
        ));
        chunks.push(options.file.data);
        chunks.push(Buffer.from("\r\n"));
    }
    chunks.push(Buffer.from(`--${BOUNDARY}--\r\n`));
    return Buffer.concat(chunks);
}

describe("POST /v1/chat/upload-image", () => {
    let app: ReturnType<typeof fastify>;

    beforeEach(async () => {
        resetState();
        canSendMessagesMock.mockReset();
        canSendMessagesMock.mockResolvedValue(true);
        chatImageUploadMock.mockClear();

        app = fastify();
        app.setValidatorCompiler(validatorCompiler);
        app.setSerializerCompiler(serializerCompiler);
        app.decorate("authenticate", async (request: any, reply: any) => {
            const userId = request.headers["x-user-id"];
            if (typeof userId !== "string") {
                return reply.code(401).send({ error: "Unauthorized" });
            }
            request.userId = userId;
        });
        await app.register(import("@fastify/multipart"), {
            limits: { fileSize: 10 * 1024 * 1024 },
        });
        chatRoutes(app as unknown as Fastify);
        await app.ready();
    });

    afterEach(async () => {
        await app.close();
    });

    const upload = (userId: string, payload: Buffer) => app.inject({
        method: "POST",
        url: "/v1/chat/upload-image",
        headers: {
            "x-user-id": userId,
            "content-type": `multipart/form-data; boundary=${BOUNDARY}`,
        },
        payload,
    });

    const jpeg = { filename: "image.jpg", contentType: "image/jpeg", data: Buffer.from("fake-jpeg") };

    it("lets the session owner upload an image", async () => {
        seedSession("s1", "owner-1");

        const res = await upload("owner-1", multipartPayload({ sessionId: "s1", file: jpeg }));

        expect(res.statusCode).toBe(200);
        expect(res.json().data.url).toContain("/public/users/owner-1/chat/s1/");
        expect(chatImageUploadMock).toHaveBeenCalledWith("owner-1", "s1", expect.any(Buffer), "image/jpeg");
    });

    it("lets a sharee with edit access upload an image", async () => {
        seedSession("s1", "owner-1");

        const res = await upload("sharee-2", multipartPayload({ sessionId: "s1", file: jpeg }));

        expect(res.statusCode).toBe(200);
        expect(canSendMessagesMock).toHaveBeenCalledWith("sharee-2", "s1");
        expect(chatImageUploadMock).toHaveBeenCalledTimes(1);
    });

    it("stores a sharee's upload under the session owner, not the uploader", async () => {
        seedSession("s1", "owner-1");

        await upload("sharee-2", multipartPayload({ sessionId: "s1", file: jpeg }));

        // Directory and DB attribution follow the session owner so all session
        // material stays together (and is cleaned up with the owner's session).
        expect(chatImageUploadMock).toHaveBeenCalledWith("owner-1", "s1", expect.any(Buffer), "image/jpeg");
    });

    it("rejects a user without edit access", async () => {
        seedSession("s1", "owner-1");
        canSendMessagesMock.mockResolvedValue(false);

        const res = await upload("stranger-3", multipartPayload({ sessionId: "s1", file: jpeg }));

        expect(res.statusCode).toBe(404);
        expect(chatImageUploadMock).not.toHaveBeenCalled();
    });

    it("rejects an unknown session with the same 404 as a denied one", async () => {
        canSendMessagesMock.mockResolvedValue(false);

        const res = await upload("stranger-3", multipartPayload({ sessionId: "missing", file: jpeg }));

        expect(res.statusCode).toBe(404);
        expect(res.json().error).toBe("Session not found");
        expect(chatImageUploadMock).not.toHaveBeenCalled();
    });

    it("rejects unsupported mime types", async () => {
        seedSession("s1", "owner-1");

        const res = await upload("owner-1", multipartPayload({
            sessionId: "s1",
            file: { filename: "image.gif", contentType: "image/gif", data: Buffer.from("fake-gif") },
        }));

        expect(res.statusCode).toBe(400);
        expect(res.json().error).toBe("Only JPEG and PNG images are supported");
        expect(chatImageUploadMock).not.toHaveBeenCalled();
    });

    it("requires a file", async () => {
        seedSession("s1", "owner-1");

        const res = await upload("owner-1", multipartPayload({ sessionId: "s1", file: null }));

        expect(res.statusCode).toBe(400);
        expect(res.json().error).toBe("No file uploaded");
    });

    it("requires a sessionId", async () => {
        seedSession("s1", "owner-1");

        const res = await upload("owner-1", multipartPayload({ file: jpeg }));

        expect(res.statusCode).toBe(400);
        expect(res.json().error).toBe("sessionId is required");
    });
});
