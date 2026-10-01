import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Post,
  Res
} from "@nestjs/common";
import type { Response } from "express";
import { StorageService } from "./storage.service.js";

@Controller("storage")
export class StorageController {
  constructor(private readonly storage: StorageService) {}

  @Post("upload")
  async upload(
    @Body()
    body: {
      fileName?: string;
      mimeType?: string;
      fileBase64?: string;
    }
  ) {
    if (!body.fileBase64) {
      throw new BadRequestException("fileBase64 là bắt buộc.");
    }
    if (!body.mimeType) {
      throw new BadRequestException("mimeType là bắt buộc.");
    }
    return this.storage.saveBase64File({
      fileName: body.fileName || "attachment",
      mimeType: body.mimeType,
      fileBase64: body.fileBase64
    });
  }

  @Get("files/:fileId")
  async getFile(
    @Param("fileId") fileId: string,
    @Res() res: Response
  ) {
    const file = await this.storage.getFile(fileId);
    res.setHeader("Content-Type", file.mimeType);
    res.setHeader("Cache-Control", "public, max-age=86400, immutable");
    res.setHeader(
      "Content-Disposition",
      `inline; filename="${encodeURIComponent(file.fileName)}"`
    );
    res.send(file.buffer);
  }
}
