import { PrismaClient } from '@prisma/client';

const prismaClient = new PrismaClient();

export const getNextTask = async (userId: number) => {
    const task = await prismaClient.task.findFirst({
        where: {
            done: false,
            submission:{
                none: {
                    worker_id: userId,
                }
            }
        }, 
        select: {
            id: true,
            amount: true,
            title: true,
            option: true,
        }
    });

    return task;
}