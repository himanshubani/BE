import { PrismaClient } from "@prisma/client";
import { Router } from "express";
import {
  S3Client,
  GetObjectCommand,
  PutObjectCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import jwt from "jsonwebtoken";
import { JWT_SECRET, TOTAL_DECIMALS } from "../config";
import { authMiddleware } from "../middleware";
import { createPresignedPost } from "@aws-sdk/s3-presigned-post";
import { createTaskInput } from "../types";

const DEFAULT_TITLE = "Select the most clickable thumbnail";

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
  const body = req.body;
  //@ts-ignore
  const userId = req.userId;
  const parseData = createTaskInput.safeParse(body);
  if (!parseData.success) {
    res.status(400).json({ error: parseData.error });
  }

  let response = await prismaClient.$transaction(async (tx) => {
    const response = await tx.task.create({
      data: {
        title: parseData.data?.title ?? DEFAULT_TITLE,
        amount: 1 * TOTAL_DECIMALS,
        signature: parseData.data?.signature ?? "",
        user_id: userId,
      },
    });

    await tx.option.createMany({
      data:
        parseData.data?.options?.map((option: any) => ({
          image_url: option.imageUrl,
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
  const hardcodedWalletAddress = "By6kpYivWkzyeYkc48Ges45z1MQB8JaUWb1TeAMiZCwx";
  const existingUser = await prismaClient.user.findFirst({
    where: { address: hardcodedWalletAddress },
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
        address: hardcodedWalletAddress,
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