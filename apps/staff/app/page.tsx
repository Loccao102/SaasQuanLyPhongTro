import { StaffSessionGate } from "../components/staff-session-gate";
import { StaffMeterEntryClient } from "./staff-meter-entry-client";

export default function StaffHomePage() {
  return (
    <StaffSessionGate>
      <StaffMeterEntryClient />
    </StaffSessionGate>
  );
}
