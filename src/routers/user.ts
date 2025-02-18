import { PrismaClient } from "@prisma/client";
import { Router } from "express";
import {S3Client,} from "@aws-sdk/client-s3";
import jwt from "jsonwebtoken";
import { JWT_SECRET, TOTAL_DECIMALS } from "../config";
import { authMiddleware } from "../middleware";
import { createPresignedPost } from "@aws-sdk/s3-presigned-post";
import { createTaskInput } from "../types";
import nacl from "tweetnacl";
import { Connection, PublicKey, Transaction } from "@solana/web3.js";
import { any } from "zod";

const DEFAULT_TITLE = "Select the most clickable thumbnail";

const connection = new Connection(process.env.RPC_URL ?? "");

const PARENT_WALLET_ADDRESS = "6XWGqsxcdEpDHFrnbNpy4PvdGc13PJT3zSUVZaF2CTTL";

const s3Client = new S3Client({
  credentials: {
    accessKeyId: process.env.accessKeyId ?? "",
    secretAccessKey: process.env.secretAccessKey ?? ""
  },
  region: "eu-north-1",
});

const router = Router();
const prismaClient = new PrismaClient();
const { v4: uuidv4 } = require("uuid");


router.get("/task", authMiddleware, async (req, res) => {
  // @ts-ignore
  const taskId: string = req.query.taskId;
  // @ts-ignore
  const userId: string = req.userId;

  const taskDetails = await prismaClient.task.findFirst({
      where: {
          user_id: Number(userId),
          id: Number(taskId)
      },
      include: {
          option: true
      }
  })

  if (!taskDetails) {
      res.status(411).json({
          message: "You dont have access to this task"
      })
  }

  // Todo: Can u make this faster?
  const responses = await prismaClient.submission.findMany({
      where: {
          task_id: Number(taskId)
      },
      include: {
          option: true
      }
  });

  const result: Record<string, {
      count: number;
      option: {
          imageUrl: string
      }
  }> = {};

  taskDetails?.option.forEach(option => {
      result[option.id] = {
          count: 0,
          option: {
              imageUrl: option.image_url
          }
      }
  })

  responses.forEach(r => {
      result[r.option_id].count++;
  });

  res.json({
      result,
      taskDetails
  })

})

router.post("/task", authMiddleware, async (req, res) => {
  //@ts-ignore
  const userId = req.userId;
  const body = req.body;

  // Validate the inputs from the user
  const parseData = createTaskInput.safeParse(body);

  if (!parseData.success) {
     res.status(411).json({
      message: "You've sent the wrong inputs",
    });
  }

  // Fetch the user's wallet address
  const user = await prismaClient.user.findFirst({
    where: {
      id: userId,
    },
  });

  if (!user) {
     res.status(404).json({
      message: "User not found",
    });
  }

  // Check if the signature has already been used
  const existingTask = await prismaClient.task.findFirst({
    where: {
      signature: parseData.data?.signature,
    },
  });

  if (existingTask) {
     res.status(411).json({
      message: "Transaction signature already used",
    });
  }

  // Create the task
  let response = await prismaClient.$transaction(async (tx) => {
    const response = await tx.task.create({
      data: {
        title: parseData.data?.title ?? DEFAULT_TITLE,
        amount: 0.1 * TOTAL_DECIMALS,
        signature: parseData.data?.signature ?? "",
        user_id: userId,
      },
    });

    await tx.option.createMany({
      data:
        parseData.data?.options?.map((x: any) => ({
          image_url: x.imageUrl,
          task_id: response.id,
        })) ?? [],
    });

    return response;
  });

  res.json({
    id: response.id,
  });
});

router.get("/presignedUrl", authMiddleware, async (req, res) => {
  //@ts-ignore
  const userId = req.userId;
  const fileExtension = req.query.fileExtension || "jpg"; // Default to "jpg" if not provided

  try {
    const { url, fields } = await createPresignedPost(s3Client, {
      Bucket: "web3saashimanshu",
      Key: `fiver/${userId}/${uuidv4()}/image.${fileExtension}`,
      Conditions: [
        ["content-length-range", 0, 5 * 1024 * 1024], // 5 MB max
      ],
      Fields: {}, // Let the client specify the Content-Type
      Expires: 3600, // 1 hour
    });

    res.json({ presignedUrl: url, fields });
  } catch (error) {
    console.error("Error generating presigned URL:", error);
    res.status(500).json({ error: "Failed to generate presigned URL" });
  }
});

router.post("/signin", async (req, res) => {
  const { publicKey, signature } = req.body;
  const signedString = "sign into mechanical turks";
  const message = new TextEncoder().encode("Sign into mechanical turks");

  const result = nacl.sign.detached.verify(
    message,
    new Uint8Array(signature.data),
    new PublicKey(publicKey).toBytes()
  ); // Verify the signature

  console.log("Signature verification result:", result);

  const existingUser = await prismaClient.user.findFirst({
    where: { address: publicKey },
  });

  if (existingUser) {
    const token = jwt.sign(
      {
        userId: existingUser?.id,
      },
      JWT_SECRET
    );
    res.json({ token });
  } else {
    const user = await prismaClient.user.create({
      data: {
        address: publicKey,
      },
    });

    const token = jwt.sign(
      {
        userId: user.id,
      },
      JWT_SECRET
    );
    res.json({ token });
  }
});

export default router;