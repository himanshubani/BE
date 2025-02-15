import { NextFunction, Request, Response } from "express";
import jwt from "jsonwebtoken";
import { JWT_SECRET, WORKER_JWT_SECRET } from "./config";

export function authMiddleware(
  req: Request,
  res: Response,
  next: NextFunction
){
  const authHeader = req.headers["authorization"] ?? "";

  try {
    const decoded = jwt.verify(authHeader, JWT_SECRET);
    //@ts-ignore
    if (decoded.userId) {
      //@ts-ignore
      req.userId = decoded.userId;
      next();
    } else {
       res.status(401).json({ message: "Unauthorized user" });
    }
  } catch (error) {
     res.status(401).json({ message: "Unauthorized" });
  }
}

export function workerMiddleware(
  req: Request,
  res: Response,
  next: NextFunction
){
  const authHeader = req.headers["authorization"] ?? "";

  try {
    const decoded = jwt.verify(authHeader, WORKER_JWT_SECRET);
    //@ts-ignore
    if (decoded.userId) {
      //@ts-ignore
      req.userId = decoded.userId;
      next();
    } else {
       res.status(401).json({ message: "Unauthorized user" });
    }
  } catch (error) {
     res.status(401).json({ message: "Unauthorized" });
  }
}