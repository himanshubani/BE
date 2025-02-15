import { PrismaClient } from "@prisma/client";
import { Router } from "express";
import jwt from "jsonwebtoken";
import { workerMiddleware } from "../middleware";
import { TOTAL_DECIMALS, WORKER_JWT_SECRET } from "../config";
import { getNextTask } from "../db";
import { createSubmissionInput } from "../types";

const TOTAL_SUBMISSIONS = 100;
const router = Router();
const prismaClient = new PrismaClient();

router.post("/payout", workerMiddleware, async (req, res) => {
    //@ts-ignore
    const userId = req.userId;
    const worker = await prismaClient.worker.findFirst({
      where:{
        id: Number(userId)
      }
    })
    if(!worker){
        res.status(404).json({
            message: "Worker not found"
        });
    }
    const pendingAmount = worker?.pending_amount ?? 0;
    const address = worker?.address;
    const txnId = "0x364912639";

    await prismaClient.$transaction(async (tx) => {
        await tx.worker.update({
            where: {
                id: Number(userId)
            },
            data: {
                pending_amount: {
                    decrement: worker?.pending_amount
                },
                locked_amount: {
                    increment: worker?.pending_amount
                }
            }
        });

        await tx.payouts.create({
            data: {
                user_id: Number(userId),
                amount: pendingAmount,
                status: "Processing",
                signature: txnId 
            }
        });
    });

    res.json({
        message: "Payout initiated",  
        amount: pendingAmount
    });
});

router.get("/balance", workerMiddleware, async (req, res) => {
    //@ts-ignore
    const userId = req.userId;
    const worker = await prismaClient.worker.findFirst({
        where: {
            id: userId
        },
        select: {
            pending_amount: true,
            locked_amount: true
        }
    });

    res.json(worker);
});

router.post("/signin", async (req, res) => {
  const hardcodedWalletAddress = "Ay6kpYivWkzyeYkc48Ges45z1MQB8JaUWb1TeAMiZCwx";
  const existingUser = await prismaClient.worker.findFirst({
    where: { address: hardcodedWalletAddress },
  });

  if (existingUser) {
    const token = jwt.sign(
      {
        userId: existingUser?.id,
      },
      WORKER_JWT_SECRET
    );
    res.json({ token });
  } else {
    const user = await prismaClient.worker.create({
      data: {
        address: hardcodedWalletAddress,
        pending_amount: 0,
        locked_amount: 0,
      },
    });

    const token = jwt.sign(
      {
        userId: user.id,
      },
      WORKER_JWT_SECRET
    );
    res.json({ token });
  }
});

router.get("/nextTask", workerMiddleware, async (req, res) => {
    //@ts-ignore
    const userId = req.userId;
    const task = await getNextTask(Number(userId));

    if(!task){
        res.status(411).json({
            message: "No more tasks left for you to review"
        });
    } else {
        res.status(200).json({task});
    }
});

router.post("/submission", workerMiddleware, async (req, res) => {
    //@ts-ignore
    const userId = req.userId;
    const body = req.body;
    const parsedBody = createSubmissionInput.safeParse(body);

    if(parsedBody.success){
        const task = await getNextTask(Number(userId));
        if(!task || task?.id !== Number(parsedBody.data.taskId)){
            res.status(411).json({
                message: "Invalid task id"
            });
        }

        const amount = (Number(task?.amount) / TOTAL_SUBMISSIONS)
        
        const submission = await prismaClient.$transaction(async (tx) => {
            const submission = await tx.submission.create({
                data: {
                    option_id: Number(parsedBody.data.selection),
                    worker_id: userId,
                    task_id: Number(parsedBody.data.taskId),
                    amount
                }
            });
            
            await tx.worker.update({
                where: {
                    id: userId
                },
                data: {
                    pending_amount: {
                        increment: Number(amount) 
                    }
                }
            });

            return submission;
        });
        const nextTask = await getNextTask(Number(userId));
        res.json({
            nextTask,
            amount
        })
    }

});

export default router;