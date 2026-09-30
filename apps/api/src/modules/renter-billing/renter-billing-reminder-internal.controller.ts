import { Body, Controller, Post, UseGuards } from "@nestjs/common";
import { InternalServiceGuard } from "../internal/internal-service.guard.js";
import { RenterBillingReminderService } from "./renter-billing-reminder.service.js";

type ReminderSweepInput = {
  limit?: number;
};

@Controller("internal/renter-billing")
@UseGuards(InternalServiceGuard)
export class RenterBillingReminderInternalController {
  constructor(private readonly reminderService: RenterBillingReminderService) {}

  @Post("reminder-sweep")
  async sweep(@Body() input?: ReminderSweepInput) {
    const limit = typeof input?.limit === "number" && input.limit > 0 ? input.limit : 100;
    return this.reminderService.sweepDueReminders(limit);
  }
}
