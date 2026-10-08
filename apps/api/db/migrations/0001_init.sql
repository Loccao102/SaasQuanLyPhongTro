--
-- PostgreSQL database dump
--


-- Dumped from database version 17.11
-- Dumped by pg_dump version 17.11

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET transaction_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: pgcrypto; Type: EXTENSION; Schema: -; Owner: -
--

CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA public;


--
-- Name: EXTENSION pgcrypto; Type: COMMENT; Schema: -; Owner: -
--

COMMENT ON EXTENSION pgcrypto IS 'cryptographic functions';


--
-- Name: enforce_tenant_membership_user_scope(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.enforce_tenant_membership_user_scope() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE
  user_account_type text;
  user_organization_id uuid;
BEGIN
  SELECT account_type, organization_id
    INTO user_account_type, user_organization_id
  FROM users
  WHERE id = NEW.user_id
  FOR UPDATE;

  IF user_account_type IS NULL THEN
    RAISE EXCEPTION 'Membership user does not exist.';
  END IF;

  IF user_account_type <> 'TENANT' THEN
    RAISE EXCEPTION 'Platform account cannot receive a tenant membership.';
  END IF;

  IF user_organization_id IS NULL THEN
    UPDATE users
    SET organization_id = NEW.organization_id,
        updated_at = now()
    WHERE id = NEW.user_id;
  ELSIF user_organization_id <> NEW.organization_id THEN
    RAISE EXCEPTION 'Tenant account is already bound to another organization.';
  END IF;

  RETURN NEW;
END $$;


SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: administrative_areas; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.administrative_areas (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    parent_id uuid,
    code text,
    name text NOT NULL,
    area_type text NOT NULL,
    level smallint NOT NULL,
    effective_from date,
    effective_to date,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT administrative_areas_check CHECK (((effective_to IS NULL) OR (effective_from IS NULL) OR (effective_to >= effective_from))),
    CONSTRAINT administrative_areas_level_check CHECK ((level >= 0))
);


--
-- Name: audit_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.audit_events (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    organization_id uuid NOT NULL,
    actor_user_id uuid,
    action text NOT NULL,
    resource_type text NOT NULL,
    resource_id uuid,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    occurred_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: auth_mfa_challenges; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.auth_mfa_challenges (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    token_hash bytea NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    consumed_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    purpose text DEFAULT 'VERIFY'::text NOT NULL,
    CONSTRAINT auth_mfa_challenges_check CHECK ((expires_at > created_at)),
    CONSTRAINT auth_mfa_challenges_purpose_check CHECK ((purpose = ANY (ARRAY['VERIFY'::text, 'ENROLL'::text])))
);


--
-- Name: auth_password_reset_tokens; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.auth_password_reset_tokens (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    token_hash bytea NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    consumed_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT auth_password_reset_tokens_check CHECK ((expires_at > created_at))
);


--
-- Name: auth_pending_registrations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.auth_pending_registrations (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    email text NOT NULL,
    display_name text NOT NULL,
    organization_name text NOT NULL,
    password_hash bytea NOT NULL,
    password_salt bytea NOT NULL,
    scrypt_n integer NOT NULL,
    scrypt_r integer NOT NULL,
    scrypt_p integer NOT NULL,
    token_hash bytea NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    consumed_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT auth_pending_registrations_check CHECK ((expires_at > created_at)),
    CONSTRAINT auth_pending_registrations_scrypt_n_check CHECK ((scrypt_n >= 16384)),
    CONSTRAINT auth_pending_registrations_scrypt_p_check CHECK ((scrypt_p > 0)),
    CONSTRAINT auth_pending_registrations_scrypt_r_check CHECK ((scrypt_r > 0))
);


--
-- Name: auth_rate_limit_buckets; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.auth_rate_limit_buckets (
    action text NOT NULL,
    key_hash bytea NOT NULL,
    window_start timestamp with time zone NOT NULL,
    attempt_count integer DEFAULT 0 NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT auth_rate_limit_buckets_attempt_count_check CHECK ((attempt_count >= 0))
);


--
-- Name: auth_security_alerts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.auth_security_alerts (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    source_event_id uuid,
    user_id uuid,
    organization_id uuid,
    alert_type text NOT NULL,
    severity text NOT NULL,
    summary text NOT NULL,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    delivery_status text DEFAULT 'PENDING'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    delivered_at timestamp with time zone,
    CONSTRAINT auth_security_alerts_delivery_status_check CHECK ((delivery_status = ANY (ARRAY['PENDING'::text, 'SENT'::text, 'SKIPPED'::text, 'FAILED'::text]))),
    CONSTRAINT auth_security_alerts_severity_check CHECK ((severity = ANY (ARRAY['LOW'::text, 'MEDIUM'::text, 'HIGH'::text])))
);


--
-- Name: auth_security_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.auth_security_events (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    event_type text NOT NULL,
    outcome text NOT NULL,
    user_id uuid,
    organization_id uuid,
    identifier_hash bytea,
    ip_hash bytea,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    occurred_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT auth_security_events_outcome_check CHECK ((outcome = ANY (ARRAY['SUCCESS'::text, 'FAILURE'::text, 'BLOCKED'::text])))
);


--
-- Name: auth_sessions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.auth_sessions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    auth_version integer NOT NULL,
    token_hash bytea NOT NULL,
    csrf_hash bytea NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    revoked_at timestamp with time zone,
    last_seen_at timestamp with time zone DEFAULT now() NOT NULL,
    organization_id uuid,
    user_agent text,
    device_label text,
    reauthenticated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT auth_sessions_auth_version_check CHECK ((auth_version > 0)),
    CONSTRAINT auth_sessions_check CHECK ((expires_at > created_at))
);


--
-- Name: auth_webauthn_challenges; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.auth_webauthn_challenges (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid,
    challenge text NOT NULL,
    purpose text NOT NULL,
    parent_mfa_token_hash bytea,
    expires_at timestamp with time zone NOT NULL,
    consumed_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    session_id uuid,
    CONSTRAINT auth_webauthn_challenges_context_check CHECK ((((purpose = 'REGISTRATION'::text) AND (user_id IS NOT NULL) AND (parent_mfa_token_hash IS NULL) AND (session_id IS NULL)) OR ((purpose = 'AUTHENTICATION'::text) AND (user_id IS NOT NULL) AND (parent_mfa_token_hash IS NOT NULL) AND (session_id IS NULL)) OR ((purpose = 'STEP_UP'::text) AND (user_id IS NOT NULL) AND (parent_mfa_token_hash IS NULL) AND (session_id IS NOT NULL)) OR ((purpose = ANY (ARRAY['PASSWORDLESS_TENANT'::text, 'PASSWORDLESS_PLATFORM'::text])) AND (user_id IS NULL) AND (parent_mfa_token_hash IS NULL) AND (session_id IS NULL)))),
    CONSTRAINT auth_webauthn_challenges_purpose_check CHECK ((purpose = ANY (ARRAY['REGISTRATION'::text, 'AUTHENTICATION'::text, 'STEP_UP'::text, 'PASSWORDLESS_TENANT'::text, 'PASSWORDLESS_PLATFORM'::text])))
);


--
-- Name: automation_quota_consumptions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.automation_quota_consumptions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    organization_id uuid NOT NULL,
    reservation_id uuid NOT NULL,
    consumption_key text NOT NULL,
    quantity integer NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT automation_quota_consumptions_quantity_check CHECK ((quantity > 0))
);


--
-- Name: automation_quota_periods; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.automation_quota_periods (
    organization_id uuid NOT NULL,
    period_start date NOT NULL,
    period_end date NOT NULL,
    reserved_actions integer DEFAULT 0 NOT NULL,
    consumed_actions integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT automation_quota_periods_check CHECK ((period_end > period_start)),
    CONSTRAINT automation_quota_periods_consumed_actions_check CHECK ((consumed_actions >= 0)),
    CONSTRAINT automation_quota_periods_reserved_actions_check CHECK ((reserved_actions >= 0))
);


--
-- Name: automation_quota_reservations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.automation_quota_reservations (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    organization_id uuid NOT NULL,
    period_start date NOT NULL,
    idempotency_key text NOT NULL,
    source_type text NOT NULL,
    source_id text,
    requested_actions integer NOT NULL,
    consumed_actions integer DEFAULT 0 NOT NULL,
    released_actions integer DEFAULT 0 NOT NULL,
    status text DEFAULT 'OPEN'::text NOT NULL,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT automation_quota_reservations_check CHECK (((consumed_actions + released_actions) <= requested_actions)),
    CONSTRAINT automation_quota_reservations_consumed_actions_check CHECK ((consumed_actions >= 0)),
    CONSTRAINT automation_quota_reservations_released_actions_check CHECK ((released_actions >= 0)),
    CONSTRAINT automation_quota_reservations_requested_actions_check CHECK ((requested_actions > 0)),
    CONSTRAINT automation_quota_reservations_status_check CHECK ((status = ANY (ARRAY['OPEN'::text, 'COMPLETED'::text, 'RELEASED'::text])))
);


--
-- Name: floors; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.floors (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    organization_id uuid NOT NULL,
    property_id uuid NOT NULL,
    code text NOT NULL,
    name text NOT NULL,
    sort_order integer DEFAULT 0 NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: lease_amendments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.lease_amendments (
    id uuid NOT NULL,
    organization_id uuid NOT NULL,
    lease_id uuid NOT NULL,
    amendment_number text NOT NULL,
    effective_date date NOT NULL,
    changes_summary text NOT NULL,
    adjusted_base_rent_vnd bigint,
    adjusted_deposit_required_vnd bigint,
    adjusted_planned_end_date date,
    note text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    actor_user_id uuid,
    CONSTRAINT lease_amendments_adjusted_base_rent_vnd_check CHECK (((adjusted_base_rent_vnd IS NULL) OR (adjusted_base_rent_vnd >= 0))),
    CONSTRAINT lease_amendments_adjusted_deposit_required_vnd_check CHECK (((adjusted_deposit_required_vnd IS NULL) OR (adjusted_deposit_required_vnd >= 0)))
);


--
-- Name: lease_attachments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.lease_attachments (
    id uuid NOT NULL,
    organization_id uuid NOT NULL,
    lease_id uuid NOT NULL,
    attachment_type text NOT NULL,
    file_name text NOT NULL,
    file_url text NOT NULL,
    file_size_bytes bigint,
    mime_type text,
    note text,
    uploaded_at timestamp with time zone DEFAULT now() NOT NULL,
    actor_user_id uuid,
    CONSTRAINT lease_attachments_attachment_type_check CHECK ((attachment_type = ANY (ARRAY['CITIZEN_ID_FRONT'::text, 'CITIZEN_ID_BACK'::text, 'HANDOVER_MINUTES'::text, 'CONTRACT_SCAN'::text, 'OTHER'::text])))
);


--
-- Name: lease_command_receipts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.lease_command_receipts (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    organization_id uuid NOT NULL,
    idempotency_key text NOT NULL,
    command_type text NOT NULL,
    lease_id uuid,
    response_payload jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: lease_deposit_entries; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.lease_deposit_entries (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    organization_id uuid NOT NULL,
    lease_id uuid NOT NULL,
    entry_type text NOT NULL,
    amount_vnd bigint NOT NULL,
    occurred_at timestamp with time zone NOT NULL,
    note text,
    created_by_user_id uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT lease_deposit_entries_amount_vnd_check CHECK ((amount_vnd > 0)),
    CONSTRAINT lease_deposit_entries_entry_type_check CHECK ((entry_type = ANY (ARRAY['COLLECTION'::text, 'REFUND'::text, 'DEDUCTION'::text])))
);


--
-- Name: lease_residents; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.lease_residents (
    organization_id uuid NOT NULL,
    lease_id uuid NOT NULL,
    resident_id uuid NOT NULL,
    party_role text NOT NULL,
    joined_on date NOT NULL,
    left_on date,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT lease_residents_check CHECK (((left_on IS NULL) OR (left_on >= joined_on))),
    CONSTRAINT lease_residents_party_role_check CHECK ((party_role = ANY (ARRAY['PRIMARY_TENANT'::text, 'CO_TENANT'::text, 'OCCUPANT'::text])))
);


--
-- Name: lease_terminations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.lease_terminations (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    organization_id uuid NOT NULL,
    lease_id uuid NOT NULL,
    status text DEFAULT 'SCHEDULED'::text NOT NULL,
    effective_date date NOT NULL,
    reason text NOT NULL,
    meter_readiness text DEFAULT 'PENDING'::text NOT NULL,
    financial_readiness text DEFAULT 'PENDING'::text NOT NULL,
    deposit_readiness text DEFAULT 'PENDING'::text NOT NULL,
    initiated_by_user_id uuid,
    completed_by_user_id uuid,
    cancelled_by_user_id uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    completed_at timestamp with time zone,
    cancelled_at timestamp with time zone,
    CONSTRAINT lease_terminations_deposit_readiness_check CHECK ((deposit_readiness = ANY (ARRAY['PENDING'::text, 'READY'::text, 'NOT_REQUIRED'::text]))),
    CONSTRAINT lease_terminations_financial_readiness_check CHECK ((financial_readiness = ANY (ARRAY['PENDING'::text, 'READY'::text, 'NOT_REQUIRED'::text]))),
    CONSTRAINT lease_terminations_meter_readiness_check CHECK ((meter_readiness = ANY (ARRAY['PENDING'::text, 'READY'::text, 'NOT_REQUIRED'::text]))),
    CONSTRAINT lease_terminations_status_check CHECK ((status = ANY (ARRAY['SCHEDULED'::text, 'READY'::text, 'COMPLETED'::text, 'CANCELLED'::text])))
);


--
-- Name: lease_vehicles; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.lease_vehicles (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    organization_id uuid NOT NULL,
    lease_id uuid NOT NULL,
    vehicle_type text DEFAULT 'MOTORBIKE'::text NOT NULL,
    license_plate text NOT NULL,
    brand_model text,
    owner_name text,
    is_active boolean DEFAULT true NOT NULL,
    registered_at date DEFAULT CURRENT_DATE NOT NULL,
    unregistered_at date,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT lease_vehicles_vehicle_type_check CHECK ((vehicle_type = ANY (ARRAY['MOTORBIKE'::text, 'ELECTRIC_BIKE'::text, 'BICYCLE'::text, 'CAR'::text, 'OTHER'::text])))
);


--
-- Name: leases; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.leases (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    organization_id uuid NOT NULL,
    room_id uuid NOT NULL,
    lease_code text NOT NULL,
    status text DEFAULT 'DRAFT'::text NOT NULL,
    start_date date NOT NULL,
    planned_end_date date,
    signed_at timestamp with time zone,
    activated_at timestamp with time zone,
    termination_effective_date date,
    terminated_at timestamp with time zone,
    termination_reason text,
    base_rent_vnd bigint NOT NULL,
    deposit_required_vnd bigint DEFAULT 0 NOT NULL,
    billing_day smallint DEFAULT 1 NOT NULL,
    version integer DEFAULT 1 NOT NULL,
    created_by_user_id uuid,
    updated_by_user_id uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    renewed_from_lease_id uuid,
    signature_data_url text,
    signed_by_name text,
    signed_ip character varying(64),
    CONSTRAINT leases_base_rent_vnd_check CHECK ((base_rent_vnd >= 0)),
    CONSTRAINT leases_billing_day_check CHECK (((billing_day >= 1) AND (billing_day <= 31))),
    CONSTRAINT leases_check CHECK (((planned_end_date IS NULL) OR (planned_end_date >= start_date))),
    CONSTRAINT leases_check1 CHECK ((((status = ANY (ARRAY['TERMINATION_SCHEDULED'::text, 'TERMINATED'::text])) AND (termination_effective_date IS NOT NULL)) OR ((status = ANY (ARRAY['DRAFT'::text, 'ACTIVE'::text, 'CANCELLED'::text])) AND (termination_effective_date IS NULL)))),
    CONSTRAINT leases_check2 CHECK (((termination_effective_date IS NULL) OR (termination_effective_date >= start_date))),
    CONSTRAINT leases_deposit_required_vnd_check CHECK ((deposit_required_vnd >= 0)),
    CONSTRAINT leases_status_check CHECK ((status = ANY (ARRAY['DRAFT'::text, 'ACTIVE'::text, 'TERMINATION_SCHEDULED'::text, 'TERMINATED'::text, 'CANCELLED'::text]))),
    CONSTRAINT leases_version_check CHECK ((version > 0))
);


--
-- Name: maintenance_tickets; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.maintenance_tickets (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    organization_id uuid NOT NULL,
    property_id uuid NOT NULL,
    room_id uuid,
    lease_id uuid,
    title text NOT NULL,
    category text DEFAULT 'OTHER'::text NOT NULL,
    priority text DEFAULT 'NORMAL'::text NOT NULL,
    status text DEFAULT 'OPEN'::text NOT NULL,
    description text NOT NULL,
    resident_name text NOT NULL,
    resident_phone text,
    images text[] DEFAULT '{}'::text[] NOT NULL,
    reported_at timestamp with time zone DEFAULT now() NOT NULL,
    resolved_at timestamp with time zone,
    resolution_note text,
    repair_cost_vnd bigint DEFAULT 0 NOT NULL,
    linked_expense_id uuid,
    created_by_user_id uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT maintenance_tickets_category_check CHECK ((category = ANY (ARRAY['ELECTRICITY'::text, 'PLUMBING'::text, 'APPLIANCE'::text, 'STRUCTURAL'::text, 'INTERNET'::text, 'OTHER'::text]))),
    CONSTRAINT maintenance_tickets_priority_check CHECK ((priority = ANY (ARRAY['LOW'::text, 'NORMAL'::text, 'HIGH'::text, 'URGENT'::text]))),
    CONSTRAINT maintenance_tickets_repair_cost_vnd_check CHECK ((repair_cost_vnd >= 0)),
    CONSTRAINT maintenance_tickets_status_check CHECK ((status = ANY (ARRAY['OPEN'::text, 'IN_PROGRESS'::text, 'RESOLVED'::text, 'CLOSED'::text, 'CANCELLED'::text])))
);


--
-- Name: membership_scopes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.membership_scopes (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    organization_id uuid NOT NULL,
    membership_id uuid NOT NULL,
    scope_type text NOT NULL,
    operational_group_id uuid,
    property_id uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT membership_scopes_check CHECK ((((scope_type = 'ORGANIZATION'::text) AND (operational_group_id IS NULL) AND (property_id IS NULL)) OR ((scope_type = 'OPERATIONAL_GROUP'::text) AND (operational_group_id IS NOT NULL) AND (property_id IS NULL)) OR ((scope_type = 'PROPERTY'::text) AND (operational_group_id IS NULL) AND (property_id IS NOT NULL)))),
    CONSTRAINT membership_scopes_scope_type_check CHECK ((scope_type = ANY (ARRAY['ORGANIZATION'::text, 'OPERATIONAL_GROUP'::text, 'PROPERTY'::text])))
);


--
-- Name: meter_readings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.meter_readings (
    id uuid NOT NULL,
    organization_id uuid NOT NULL,
    meter_id uuid NOT NULL,
    reading_date date NOT NULL,
    reading_value numeric(18,3) NOT NULL,
    source text DEFAULT 'ADMIN'::text NOT NULL,
    created_by_user_id uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT meter_readings_reading_value_check CHECK ((reading_value >= (0)::numeric)),
    CONSTRAINT meter_readings_source_check CHECK ((source = ANY (ARRAY['ADMIN'::text, 'STAFF'::text, 'IMPORT'::text])))
);


--
-- Name: meters; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.meters (
    id uuid NOT NULL,
    organization_id uuid NOT NULL,
    room_id uuid NOT NULL,
    meter_type text NOT NULL,
    unit text NOT NULL,
    label text,
    is_active boolean DEFAULT true NOT NULL,
    created_by_user_id uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT meters_check CHECK ((((meter_type = 'ELECTRICITY'::text) AND (unit = 'KWH'::text)) OR ((meter_type = 'WATER'::text) AND (unit = 'M3'::text)))),
    CONSTRAINT meters_meter_type_check CHECK ((meter_type = ANY (ARRAY['ELECTRICITY'::text, 'WATER'::text]))),
    CONSTRAINT meters_unit_check CHECK ((unit = ANY (ARRAY['KWH'::text, 'M3'::text])))
);


--
-- Name: notification_attempts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.notification_attempts (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    organization_id uuid NOT NULL,
    job_id uuid NOT NULL,
    attempt_number integer NOT NULL,
    provider text NOT NULL,
    status text NOT NULL,
    outcome text,
    error_code text,
    error_message text,
    evidence jsonb DEFAULT '{}'::jsonb NOT NULL,
    started_at timestamp with time zone DEFAULT now() NOT NULL,
    finished_at timestamp with time zone,
    CONSTRAINT notification_attempts_attempt_number_check CHECK ((attempt_number >= 1)),
    CONSTRAINT notification_attempts_outcome_check CHECK (((outcome IS NULL) OR (outcome = ANY (ARRAY['SENT'::text, 'TRANSIENT_FAILURE'::text, 'PERMANENT_FAILURE'::text, 'MANUAL_REVIEW'::text, 'UNKNOWN'::text])))),
    CONSTRAINT notification_attempts_status_check CHECK ((status = ANY (ARRAY['RUNNING'::text, 'FINISHED'::text])))
);


--
-- Name: notification_campaigns; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.notification_campaigns (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    organization_id uuid NOT NULL,
    quota_reservation_id uuid NOT NULL,
    idempotency_key text NOT NULL,
    request_fingerprint text NOT NULL,
    channel text NOT NULL,
    provider text NOT NULL,
    message_body text NOT NULL,
    status text DEFAULT 'QUEUED'::text NOT NULL,
    total_recipients integer NOT NULL,
    created_by_user_id uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    source_type text,
    source_id uuid,
    CONSTRAINT notification_campaigns_source_pair_chk CHECK ((((source_type IS NULL) AND (source_id IS NULL)) OR ((source_type IS NOT NULL) AND (source_id IS NOT NULL)))),
    CONSTRAINT notification_campaigns_status_check CHECK ((status = ANY (ARRAY['QUEUED'::text, 'RUNNING'::text, 'COMPLETED'::text, 'PARTIAL_FAILED'::text, 'MANUAL_REVIEW'::text, 'PAUSED'::text, 'CANCELLED'::text]))),
    CONSTRAINT notification_campaigns_total_recipients_check CHECK ((total_recipients > 0))
);


--
-- Name: notification_jobs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.notification_jobs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    organization_id uuid NOT NULL,
    campaign_id uuid NOT NULL,
    recipient_key text NOT NULL,
    recipient_display_name text,
    provider text NOT NULL,
    status text DEFAULT 'QUEUED'::text NOT NULL,
    attempt_count integer DEFAULT 0 NOT NULL,
    max_attempts integer DEFAULT 3 NOT NULL,
    next_attempt_at timestamp with time zone,
    idempotency_key text NOT NULL,
    verification_state text DEFAULT 'NOT_ATTEMPTED'::text NOT NULL,
    last_error_code text,
    last_error_message text,
    evidence jsonb DEFAULT '{}'::jsonb NOT NULL,
    sent_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    message_body_override text,
    CONSTRAINT notification_jobs_attempt_count_check CHECK ((attempt_count >= 0)),
    CONSTRAINT notification_jobs_max_attempts_check CHECK ((max_attempts >= 1)),
    CONSTRAINT notification_jobs_message_override_length_chk CHECK (((message_body_override IS NULL) OR ((char_length(message_body_override) >= 1) AND (char_length(message_body_override) <= 4000)))),
    CONSTRAINT notification_jobs_status_check CHECK ((status = ANY (ARRAY['QUEUED'::text, 'RUNNING'::text, 'RETRY_WAIT'::text, 'SENT'::text, 'FAILED'::text, 'MANUAL_REVIEW'::text, 'CANCELLED'::text]))),
    CONSTRAINT notification_jobs_verification_state_check CHECK ((verification_state = ANY (ARRAY['NOT_ATTEMPTED'::text, 'VERIFIED'::text, 'AMBIGUOUS'::text, 'UNKNOWN'::text])))
);


--
-- Name: notification_provider_controls; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.notification_provider_controls (
    provider text NOT NULL,
    status text DEFAULT 'ACTIVE'::text NOT NULL,
    reason text,
    updated_by_user_id uuid,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT notification_provider_controls_status_check CHECK ((status = ANY (ARRAY['ACTIVE'::text, 'PAUSED'::text])))
);


--
-- Name: notification_worker_heartbeats; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.notification_worker_heartbeats (
    worker_id text NOT NULL,
    provider text NOT NULL,
    status text NOT NULL,
    started_at timestamp with time zone DEFAULT now() NOT NULL,
    last_seen_at timestamp with time zone DEFAULT now() NOT NULL,
    last_error_code text,
    last_error_message text,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT notification_worker_heartbeats_status_check CHECK ((status = ANY (ARRAY['STARTING'::text, 'HEALTHY'::text, 'DEGRADED'::text, 'STOPPING'::text])))
);


--
-- Name: operating_expenses; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.operating_expenses (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    organization_id uuid NOT NULL,
    property_id uuid,
    category text NOT NULL,
    amount_vnd bigint NOT NULL,
    occurred_at timestamp with time zone NOT NULL,
    paid_to text,
    note text,
    payment_method text DEFAULT 'CASH'::text NOT NULL,
    receipt_url text,
    created_by_user_id uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT operating_expenses_amount_vnd_check CHECK ((amount_vnd > 0)),
    CONSTRAINT operating_expenses_category_check CHECK ((category = ANY (ARRAY['REPAIR_MAINTENANCE'::text, 'UTILITIES'::text, 'MANAGEMENT_SERVICE'::text, 'CLEANING_WASTE'::text, 'TAX_FEES'::text, 'OTHER'::text]))),
    CONSTRAINT operating_expenses_payment_method_check CHECK ((payment_method = ANY (ARRAY['CASH'::text, 'BANK_TRANSFER'::text, 'OTHER'::text])))
);


--
-- Name: operational_groups; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.operational_groups (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    organization_id uuid NOT NULL,
    code text NOT NULL,
    name text NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: organization_entitlement_overrides; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.organization_entitlement_overrides (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    organization_id uuid NOT NULL,
    entitlement_key text NOT NULL,
    value jsonb NOT NULL,
    expires_at timestamp with time zone,
    reason text NOT NULL,
    created_by_user_id uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    revoked_at timestamp with time zone,
    revoked_by_user_id uuid,
    CONSTRAINT organization_entitlement_overrides_check CHECK (((revoked_at IS NOT NULL) OR (revoked_by_user_id IS NULL))),
    CONSTRAINT organization_entitlement_overrides_entitlement_key_check CHECK ((entitlement_key = ANY (ARRAY['room_limit'::text, 'staff_limit'::text, 'automation_actions_monthly'::text, 'properties'::text, 'leases'::text, 'metering'::text, 'pricing'::text, 'billing'::text, 'payments'::text, 'credit_balance'::text, 'finances'::text, 'maintenance'::text, 'notifications'::text, 'reports'::text, 'team_management'::text, 'advanced_reports'::text, 'audit_log'::text])))
);


--
-- Name: organization_memberships; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.organization_memberships (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    organization_id uuid NOT NULL,
    user_id uuid NOT NULL,
    role text NOT NULL,
    status text DEFAULT 'ACTIVE'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT organization_memberships_role_check CHECK ((role = ANY (ARRAY['OWNER'::text, 'ADMIN'::text, 'MANAGER'::text, 'STAFF'::text, 'ACCOUNTANT'::text, 'VIEWER'::text]))),
    CONSTRAINT organization_memberships_status_check CHECK ((status = ANY (ARRAY['INVITED'::text, 'ACTIVE'::text, 'SUSPENDED'::text])))
);


--
-- Name: organization_payment_profiles; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.organization_payment_profiles (
    organization_id uuid NOT NULL,
    bank_id text NOT NULL,
    account_no text NOT NULL,
    account_name text NOT NULL,
    vietqr_template text DEFAULT 'compact2'::text NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    updated_by_user_id uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT organization_payment_profiles_account_name_check CHECK (((char_length(account_name) >= 2) AND (char_length(account_name) <= 80))),
    CONSTRAINT organization_payment_profiles_account_no_check CHECK (((char_length(account_no) >= 3) AND (char_length(account_no) <= 19))),
    CONSTRAINT organization_payment_profiles_bank_id_check CHECK (((char_length(bank_id) >= 2) AND (char_length(bank_id) <= 32))),
    CONSTRAINT organization_payment_profiles_vietqr_template_check CHECK (((char_length(vietqr_template) >= 1) AND (char_length(vietqr_template) <= 64)))
);


--
-- Name: organization_subscriptions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.organization_subscriptions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    organization_id uuid NOT NULL,
    plan_id uuid NOT NULL,
    plan_version_id uuid NOT NULL,
    status text NOT NULL,
    trial_ends_at timestamp with time zone,
    current_period_start timestamp with time zone,
    current_period_end timestamp with time zone,
    grace_ends_at timestamp with time zone,
    cancel_at_period_end boolean DEFAULT false NOT NULL,
    version integer DEFAULT 1 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    billing_interval text DEFAULT 'MONTHLY'::text NOT NULL,
    past_due_at timestamp with time zone,
    CONSTRAINT organization_subscriptions_billing_interval_check CHECK ((billing_interval = ANY (ARRAY['MONTHLY'::text, 'YEARLY'::text]))),
    CONSTRAINT organization_subscriptions_status_check CHECK ((status = ANY (ARRAY['TRIALING'::text, 'ACTIVE'::text, 'PAST_DUE'::text, 'GRACE_PERIOD'::text, 'SUSPENDED'::text, 'CANCELLED'::text]))),
    CONSTRAINT organization_subscriptions_version_check CHECK ((version >= 1))
);


--
-- Name: organizations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.organizations (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    slug text NOT NULL,
    name text NOT NULL,
    organization_type text NOT NULL,
    status text DEFAULT 'ACTIVE'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT organizations_organization_type_check CHECK ((organization_type = ANY (ARRAY['INDIVIDUAL'::text, 'HOUSEHOLD_BUSINESS'::text, 'COMPANY'::text]))),
    CONSTRAINT organizations_status_check CHECK ((status = ANY (ARRAY['ACTIVE'::text, 'SUSPENDED'::text])))
);


--
-- Name: platform_audit_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.platform_audit_events (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    actor_user_id uuid,
    action text NOT NULL,
    target_type text NOT NULL,
    target_key text NOT NULL,
    organization_id uuid,
    before_state jsonb DEFAULT '{}'::jsonb NOT NULL,
    after_state jsonb DEFAULT '{}'::jsonb NOT NULL,
    reason text NOT NULL,
    occurred_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: platform_command_receipts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.platform_command_receipts (
    actor_user_id uuid NOT NULL,
    idempotency_key text NOT NULL,
    action text NOT NULL,
    request_fingerprint text NOT NULL,
    response jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: platform_operators; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.platform_operators (
    user_id uuid NOT NULL,
    role text NOT NULL,
    status text DEFAULT 'ACTIVE'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT platform_operators_role_check CHECK ((role = ANY (ARRAY['PLATFORM_ADMIN'::text, 'SUPPORT_OPERATOR'::text, 'OPS_OPERATOR'::text, 'READ_ONLY_AUDITOR'::text]))),
    CONSTRAINT platform_operators_status_check CHECK ((status = ANY (ARRAY['ACTIVE'::text, 'SUSPENDED'::text])))
);


--
-- Name: pricing_policies; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.pricing_policies (
    id uuid NOT NULL,
    organization_id uuid NOT NULL,
    property_id uuid NOT NULL,
    name text NOT NULL,
    effective_from date NOT NULL,
    effective_to date,
    created_by_user_id uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT pricing_policies_check CHECK (((effective_to IS NULL) OR (effective_to >= effective_from)))
);


--
-- Name: pricing_policy_items; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.pricing_policy_items (
    id uuid NOT NULL,
    organization_id uuid NOT NULL,
    policy_id uuid NOT NULL,
    item_type text NOT NULL,
    description text NOT NULL,
    unit_price_vnd bigint NOT NULL,
    fixed_quantity numeric(18,3) DEFAULT 1 NOT NULL,
    sort_order integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT pricing_policy_items_fixed_quantity_check CHECK ((fixed_quantity >= (0)::numeric)),
    CONSTRAINT pricing_policy_items_item_type_check CHECK ((item_type = ANY (ARRAY['ELECTRICITY_PER_KWH'::text, 'ELECTRICITY_PER_PERSON'::text, 'ELECTRICITY_PER_ROOM'::text, 'WATER_PER_M3'::text, 'WATER_PER_PERSON'::text, 'WATER_PER_ROOM'::text, 'VEHICLE_PARKING'::text, 'SERVICE_PER_PERSON'::text, 'INTERNET'::text, 'PARKING'::text, 'TRASH'::text, 'ELEVATOR'::text, 'CUSTOM'::text]))),
    CONSTRAINT pricing_policy_items_unit_price_vnd_check CHECK ((unit_price_vnd >= 0))
);


--
-- Name: properties; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.properties (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    organization_id uuid NOT NULL,
    administrative_area_id uuid,
    code text NOT NULL,
    name text NOT NULL,
    property_type text DEFAULT 'BOARDING_HOUSE'::text NOT NULL,
    address_text text,
    latitude numeric(9,6),
    longitude numeric(9,6),
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT properties_latitude_check CHECK (((latitude IS NULL) OR ((latitude >= ('-90'::integer)::numeric) AND (latitude <= (90)::numeric)))),
    CONSTRAINT properties_longitude_check CHECK (((longitude IS NULL) OR ((longitude >= ('-180'::integer)::numeric) AND (longitude <= (180)::numeric)))),
    CONSTRAINT properties_property_type_check CHECK ((property_type = ANY (ARRAY['BOARDING_HOUSE'::text, 'MINI_APARTMENT'::text, 'APARTMENT'::text, 'OTHER'::text])))
);


--
-- Name: property_operational_groups; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.property_operational_groups (
    organization_id uuid NOT NULL,
    property_id uuid NOT NULL,
    operational_group_id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: renter_billing_cycles; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.renter_billing_cycles (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    organization_id uuid NOT NULL,
    property_id uuid NOT NULL,
    cycle_code text NOT NULL,
    period_start date NOT NULL,
    period_end date NOT NULL,
    due_date date NOT NULL,
    status text DEFAULT 'OPEN'::text NOT NULL,
    created_by_user_id uuid,
    finalized_by_user_id uuid,
    finalized_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT renter_billing_cycles_check CHECK ((period_end >= period_start)),
    CONSTRAINT renter_billing_cycles_check1 CHECK ((due_date >= period_start)),
    CONSTRAINT renter_billing_cycles_status_check CHECK ((status = ANY (ARRAY['OPEN'::text, 'FINALIZED'::text, 'CANCELLED'::text])))
);


--
-- Name: renter_credit_balances; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.renter_credit_balances (
    organization_id uuid NOT NULL,
    balance_vnd bigint DEFAULT 0 NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT renter_credit_balances_balance_vnd_check CHECK ((balance_vnd >= 0))
);


--
-- Name: renter_credit_movements; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.renter_credit_movements (
    id uuid NOT NULL,
    organization_id uuid NOT NULL,
    movement_type text NOT NULL,
    amount_vnd bigint NOT NULL,
    balance_after_vnd bigint NOT NULL,
    invoice_id uuid,
    payment_transaction_id uuid,
    allocation_id uuid,
    description text,
    note text,
    created_by_user_id uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT renter_credit_movements_balance_after_vnd_check CHECK ((balance_after_vnd >= 0)),
    CONSTRAINT renter_credit_movements_movement_type_check CHECK ((movement_type = ANY (ARRAY['OVERPAYMENT_CREDIT'::text, 'CREDIT_APPLIED'::text, 'MANUAL_CREDIT'::text, 'MANUAL_DEBIT'::text, 'REFUND_ISSUED'::text, 'ALLOCATION_REVERSAL'::text])))
);


--
-- Name: renter_invoice_adjustments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.renter_invoice_adjustments (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    organization_id uuid NOT NULL,
    invoice_id uuid NOT NULL,
    adjustment_type text NOT NULL,
    description text NOT NULL,
    amount_vnd bigint NOT NULL,
    created_by_user_id uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT renter_invoice_adjustments_adjustment_type_check CHECK ((adjustment_type = ANY (ARRAY['DISCOUNT'::text, 'SURCHARGE'::text, 'COMPENSATION'::text, 'OTHER'::text])))
);


--
-- Name: renter_invoice_lines; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.renter_invoice_lines (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    organization_id uuid NOT NULL,
    invoice_id uuid NOT NULL,
    line_type text NOT NULL,
    description text NOT NULL,
    quantity numeric(18,3) DEFAULT 1 NOT NULL,
    unit_price_vnd bigint DEFAULT 0 NOT NULL,
    amount_vnd bigint NOT NULL,
    sort_order integer DEFAULT 0 NOT NULL,
    snapshot jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT renter_invoice_lines_line_type_check CHECK ((line_type = ANY (ARRAY['RENT'::text, 'ELECTRICITY'::text, 'WATER'::text, 'SERVICE'::text, 'ADJUSTMENT'::text, 'PREVIOUS_DEBT'::text]))),
    CONSTRAINT renter_invoice_lines_quantity_check CHECK ((quantity >= (0)::numeric))
);


--
-- Name: renter_invoice_public_links; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.renter_invoice_public_links (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    organization_id uuid NOT NULL,
    invoice_id uuid NOT NULL,
    token_hash character(64) NOT NULL,
    token_hint text NOT NULL,
    status text DEFAULT 'ACTIVE'::text NOT NULL,
    expires_at timestamp with time zone,
    created_by_user_id uuid,
    revoked_by_user_id uuid,
    revoked_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT renter_invoice_public_links_check CHECK ((((status = 'ACTIVE'::text) AND (revoked_at IS NULL)) OR ((status = 'REVOKED'::text) AND (revoked_at IS NOT NULL)))),
    CONSTRAINT renter_invoice_public_links_status_check CHECK ((status = ANY (ARRAY['ACTIVE'::text, 'REVOKED'::text])))
);


--
-- Name: renter_invoice_reminders; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.renter_invoice_reminders (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    organization_id uuid NOT NULL,
    invoice_id uuid NOT NULL,
    reminder_tier text NOT NULL,
    reminder_date date DEFAULT CURRENT_DATE NOT NULL,
    recipient_phone text NOT NULL,
    recipient_name text,
    remaining_vnd bigint NOT NULL,
    due_date date NOT NULL,
    channel text DEFAULT 'ZALO'::text NOT NULL,
    notification_job_id uuid,
    status text DEFAULT 'QUEUED'::text NOT NULL,
    message_text text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT renter_invoice_reminders_remaining_vnd_check CHECK ((remaining_vnd >= 0)),
    CONSTRAINT renter_invoice_reminders_reminder_tier_check CHECK ((reminder_tier = ANY (ARRAY['UPCOMING'::text, 'DUE_TODAY'::text, 'OVERDUE_STAGE_1'::text, 'OVERDUE_STAGE_2'::text, 'OVERDUE_STAGE_3'::text, 'MANUAL'::text]))),
    CONSTRAINT renter_invoice_reminders_status_check CHECK ((status = ANY (ARRAY['QUEUED'::text, 'SENT'::text, 'FAILED'::text, 'SKIPPED'::text])))
);


--
-- Name: renter_invoices; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.renter_invoices (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    organization_id uuid NOT NULL,
    billing_cycle_id uuid NOT NULL,
    property_id uuid NOT NULL,
    room_id uuid NOT NULL,
    lease_id uuid NOT NULL,
    invoice_number text NOT NULL,
    status text DEFAULT 'DRAFT'::text NOT NULL,
    period_start date NOT NULL,
    period_end date NOT NULL,
    due_date date NOT NULL,
    property_name_snapshot text NOT NULL,
    room_code_snapshot text NOT NULL,
    lease_code_snapshot text NOT NULL,
    primary_resident_name_snapshot text NOT NULL,
    subtotal_vnd bigint DEFAULT 0 NOT NULL,
    adjustment_vnd bigint DEFAULT 0 NOT NULL,
    previous_balance_vnd bigint DEFAULT 0 NOT NULL,
    total_vnd bigint DEFAULT 0 NOT NULL,
    issued_at timestamp with time zone,
    voided_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    calculation_status text DEFAULT 'READY'::text NOT NULL,
    review_reasons jsonb DEFAULT '[]'::jsonb NOT NULL,
    calculated_at timestamp with time zone,
    paid_vnd bigint DEFAULT 0 NOT NULL,
    remaining_vnd bigint DEFAULT 0 NOT NULL,
    collection_status text DEFAULT 'UNPAID'::text NOT NULL,
    payment_reference text DEFAULT ('RENT'::text || upper(replace((gen_random_uuid())::text, '-'::text, ''::text))) NOT NULL,
    CONSTRAINT renter_invoices_calculation_status_check CHECK ((calculation_status = ANY (ARRAY['READY'::text, 'REVIEW_REQUIRED'::text]))),
    CONSTRAINT renter_invoices_check CHECK ((period_end >= period_start)),
    CONSTRAINT renter_invoices_check1 CHECK ((due_date >= period_start)),
    CONSTRAINT renter_invoices_check2 CHECK ((total_vnd = ((subtotal_vnd + adjustment_vnd) + previous_balance_vnd))),
    CONSTRAINT renter_invoices_collection_status_check CHECK ((collection_status = ANY (ARRAY['UNPAID'::text, 'PARTIALLY_PAID'::text, 'PAID'::text]))),
    CONSTRAINT renter_invoices_paid_nonnegative_chk CHECK ((paid_vnd >= 0)),
    CONSTRAINT renter_invoices_payment_projection_chk CHECK (((paid_vnd + remaining_vnd) = total_vnd)),
    CONSTRAINT renter_invoices_previous_balance_vnd_check CHECK ((previous_balance_vnd >= 0)),
    CONSTRAINT renter_invoices_remaining_nonnegative_chk CHECK ((remaining_vnd >= 0)),
    CONSTRAINT renter_invoices_review_reasons_check CHECK ((jsonb_typeof(review_reasons) = 'array'::text)),
    CONSTRAINT renter_invoices_status_check CHECK ((status = ANY (ARRAY['DRAFT'::text, 'ISSUED'::text, 'VOID'::text]))),
    CONSTRAINT renter_invoices_subtotal_vnd_check CHECK ((subtotal_vnd >= 0)),
    CONSTRAINT renter_invoices_total_vnd_check CHECK ((total_vnd >= 0))
);


--
-- Name: renter_payment_allocations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.renter_payment_allocations (
    id uuid NOT NULL,
    organization_id uuid NOT NULL,
    payment_transaction_id uuid NOT NULL,
    invoice_id uuid NOT NULL,
    amount_vnd bigint NOT NULL,
    allocation_type text DEFAULT 'MANUAL'::text NOT NULL,
    created_by_user_id uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT renter_payment_allocations_allocation_type_check CHECK ((allocation_type = ANY (ARRAY['MANUAL'::text, 'AUTO'::text]))),
    CONSTRAINT renter_payment_allocations_amount_vnd_check CHECK ((amount_vnd > 0))
);


--
-- Name: renter_payment_reconciliation_cursors; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.renter_payment_reconciliation_cursors (
    provider text NOT NULL,
    scope_key text NOT NULL,
    cursor_value text,
    version integer DEFAULT 1 NOT NULL,
    last_success_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT renter_payment_reconciliation_cursors_cursor_value_check CHECK (((cursor_value IS NULL) OR ((length(cursor_value) >= 1) AND (length(cursor_value) <= 256)))),
    CONSTRAINT renter_payment_reconciliation_cursors_provider_check CHECK (((length(provider) >= 1) AND (length(provider) <= 64))),
    CONSTRAINT renter_payment_reconciliation_cursors_scope_key_check CHECK (((length(scope_key) >= 1) AND (length(scope_key) <= 128))),
    CONSTRAINT renter_payment_reconciliation_cursors_version_check CHECK ((version > 0))
);


--
-- Name: renter_payment_transactions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.renter_payment_transactions (
    id uuid NOT NULL,
    organization_id uuid NOT NULL,
    source text NOT NULL,
    provider text,
    provider_transaction_id text,
    amount_vnd bigint NOT NULL,
    occurred_at timestamp with time zone NOT NULL,
    payer_name text,
    note text,
    status text DEFAULT 'POSTED'::text NOT NULL,
    raw_payload jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_by_user_id uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    payment_reference text,
    reconciliation_status text DEFAULT 'ALLOCATED'::text NOT NULL,
    CONSTRAINT renter_payment_transactions_amount_vnd_check CHECK ((amount_vnd > 0)),
    CONSTRAINT renter_payment_transactions_check CHECK (((source = 'MANUAL'::text) OR ((source = 'PROVIDER'::text) AND (provider IS NOT NULL) AND (provider_transaction_id IS NOT NULL)))),
    CONSTRAINT renter_payment_transactions_reconciliation_status_check CHECK ((reconciliation_status = ANY (ARRAY['ALLOCATED'::text, 'REVIEW_REQUIRED'::text]))),
    CONSTRAINT renter_payment_transactions_source_check CHECK ((source = ANY (ARRAY['MANUAL'::text, 'PROVIDER'::text]))),
    CONSTRAINT renter_payment_transactions_status_check CHECK ((status = ANY (ARRAY['POSTED'::text, 'REVERSED'::text])))
);


--
-- Name: renter_payment_webhook_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.renter_payment_webhook_events (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    provider text NOT NULL,
    provider_event_id text NOT NULL,
    signature_status text NOT NULL,
    processing_status text DEFAULT 'RECEIVED'::text NOT NULL,
    raw_body text NOT NULL,
    raw_body_sha256 text NOT NULL,
    headers jsonb DEFAULT '{}'::jsonb NOT NULL,
    provider_transaction_id text,
    amount_vnd bigint,
    occurred_at timestamp with time zone,
    payment_reference text,
    payer_name text,
    note text,
    normalized_payment_fingerprint text,
    organization_id uuid,
    payment_transaction_id uuid,
    received_at timestamp with time zone DEFAULT now() NOT NULL,
    processing_started_at timestamp with time zone,
    processing_attempts integer DEFAULT 0 NOT NULL,
    processed_at timestamp with time zone,
    last_error_code text,
    last_error_message text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT renter_payment_webhook_events_amount_vnd_check CHECK (((amount_vnd IS NULL) OR (amount_vnd > 0))),
    CONSTRAINT renter_payment_webhook_events_check CHECK ((((provider_transaction_id IS NULL) AND (amount_vnd IS NULL) AND (occurred_at IS NULL) AND (normalized_payment_fingerprint IS NULL)) OR ((provider_transaction_id IS NOT NULL) AND (amount_vnd IS NOT NULL) AND (occurred_at IS NOT NULL) AND (normalized_payment_fingerprint IS NOT NULL)))),
    CONSTRAINT renter_payment_webhook_events_check1 CHECK (((payment_transaction_id IS NULL) OR (organization_id IS NOT NULL))),
    CONSTRAINT renter_payment_webhook_events_processing_attempts_check CHECK ((processing_attempts >= 0)),
    CONSTRAINT renter_payment_webhook_events_processing_status_check CHECK ((processing_status = ANY (ARRAY['RECEIVED'::text, 'PROCESSING'::text, 'PROCESSED'::text, 'REVIEW_REQUIRED'::text, 'IGNORED'::text, 'FAILED'::text]))),
    CONSTRAINT renter_payment_webhook_events_signature_status_check CHECK ((signature_status = ANY (ARRAY['VERIFIED'::text, 'INVALID'::text, 'NOT_CONFIGURED'::text])))
);


--
-- Name: renter_provider_transaction_aliases; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.renter_provider_transaction_aliases (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    provider text NOT NULL,
    identity_id uuid NOT NULL,
    alias_type text NOT NULL,
    alias_value text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: renter_provider_transaction_identities; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.renter_provider_transaction_identities (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    provider text NOT NULL,
    canonical_fingerprint character(64) NOT NULL,
    reference_number text NOT NULL,
    destination_account_no text NOT NULL,
    occurred_at timestamp with time zone NOT NULL,
    direction text NOT NULL,
    amount_vnd bigint NOT NULL,
    payment_transaction_id uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT renter_provider_transaction_identit_canonical_fingerprint_check CHECK ((canonical_fingerprint ~ '^[a-f0-9]{64}$'::text)),
    CONSTRAINT renter_provider_transaction_identities_amount_vnd_check CHECK ((amount_vnd > 0)),
    CONSTRAINT renter_provider_transaction_identities_direction_check CHECK ((direction = ANY (ARRAY['IN'::text, 'OUT'::text])))
);


--
-- Name: renter_refunds; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.renter_refunds (
    id uuid NOT NULL,
    organization_id uuid NOT NULL,
    credit_movement_id uuid NOT NULL,
    amount_vnd bigint NOT NULL,
    refund_method text DEFAULT 'CASH'::text NOT NULL,
    recipient_name text,
    recipient_account text,
    note text,
    status text DEFAULT 'COMPLETED'::text NOT NULL,
    created_by_user_id uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    completed_at timestamp with time zone,
    CONSTRAINT renter_refunds_amount_vnd_check CHECK ((amount_vnd > 0)),
    CONSTRAINT renter_refunds_refund_method_check CHECK ((refund_method = ANY (ARRAY['CASH'::text, 'BANK_TRANSFER'::text, 'OTHER'::text]))),
    CONSTRAINT renter_refunds_status_check CHECK ((status = ANY (ARRAY['COMPLETED'::text, 'PENDING'::text, 'CANCELLED'::text])))
);


--
-- Name: residents; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.residents (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    organization_id uuid NOT NULL,
    full_name text NOT NULL,
    phone text,
    email text,
    identity_document_type text,
    identity_document_number text,
    date_of_birth date,
    notes text,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: room_equipment; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.room_equipment (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    organization_id uuid NOT NULL,
    property_id uuid NOT NULL,
    room_id uuid NOT NULL,
    name text NOT NULL,
    brand text,
    model_or_serial text,
    quantity integer DEFAULT 1 NOT NULL,
    condition_status text DEFAULT 'GOOD'::text NOT NULL,
    compensation_value_vnd bigint DEFAULT 0 NOT NULL,
    note text,
    installed_at date,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT room_equipment_compensation_value_vnd_check CHECK ((compensation_value_vnd >= 0)),
    CONSTRAINT room_equipment_condition_status_check CHECK ((condition_status = ANY (ARRAY['EXCELLENT'::text, 'GOOD'::text, 'FAIR'::text, 'DAMAGED'::text, 'NEEDS_REPAIR'::text]))),
    CONSTRAINT room_equipment_quantity_check CHECK ((quantity > 0))
);


--
-- Name: room_reservations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.room_reservations (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    organization_id uuid NOT NULL,
    property_id uuid NOT NULL,
    room_id uuid NOT NULL,
    prospective_tenant_name text NOT NULL,
    prospective_tenant_phone text NOT NULL,
    prospective_tenant_id_number text,
    deposit_amount_vnd bigint NOT NULL,
    reserved_from date DEFAULT CURRENT_DATE NOT NULL,
    reserved_until date NOT NULL,
    expected_move_in_date date,
    expected_monthly_rent_vnd bigint,
    status text DEFAULT 'ACTIVE'::text NOT NULL,
    notes text,
    created_by_user_id uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT room_reservations_check CHECK ((reserved_until >= reserved_from)),
    CONSTRAINT room_reservations_deposit_amount_vnd_check CHECK ((deposit_amount_vnd >= 0)),
    CONSTRAINT room_reservations_expected_monthly_rent_vnd_check CHECK (((expected_monthly_rent_vnd IS NULL) OR (expected_monthly_rent_vnd >= 0))),
    CONSTRAINT room_reservations_status_check CHECK ((status = ANY (ARRAY['ACTIVE'::text, 'CONVERTED_TO_LEASE'::text, 'CANCELLED_REFUNDED'::text, 'CANCELLED_FORFEITED'::text, 'EXPIRED'::text])))
);


--
-- Name: rooms; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.rooms (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    organization_id uuid NOT NULL,
    property_id uuid NOT NULL,
    floor_id uuid,
    code text NOT NULL,
    name text NOT NULL,
    sort_order integer DEFAULT 0 NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: saas_billing_webhook_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.saas_billing_webhook_events (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    provider text NOT NULL,
    provider_event_id text NOT NULL,
    signature_status text NOT NULL,
    processing_status text DEFAULT 'RECEIVED'::text NOT NULL,
    raw_body text NOT NULL,
    raw_body_sha256 text NOT NULL,
    headers jsonb DEFAULT '{}'::jsonb NOT NULL,
    received_at timestamp with time zone DEFAULT now() NOT NULL,
    processing_started_at timestamp with time zone,
    processing_attempts integer DEFAULT 0 NOT NULL,
    processed_at timestamp with time zone,
    last_error_code text,
    last_error_message text,
    payment_id uuid,
    normalized_payment_fingerprint text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT saas_billing_webhook_events_check CHECK ((((payment_id IS NULL) AND (normalized_payment_fingerprint IS NULL)) OR ((payment_id IS NOT NULL) AND (normalized_payment_fingerprint IS NOT NULL)))),
    CONSTRAINT saas_billing_webhook_events_processing_attempts_check CHECK ((processing_attempts >= 0)),
    CONSTRAINT saas_billing_webhook_events_processing_status_check CHECK ((processing_status = ANY (ARRAY['RECEIVED'::text, 'PROCESSING'::text, 'PROCESSED'::text, 'REVIEW_REQUIRED'::text, 'IGNORED'::text, 'FAILED'::text]))),
    CONSTRAINT saas_billing_webhook_events_signature_status_check CHECK ((signature_status = ANY (ARRAY['VERIFIED'::text, 'INVALID'::text, 'NOT_CONFIGURED'::text])))
);


--
-- Name: saas_plan_versions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.saas_plan_versions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    plan_id uuid NOT NULL,
    version integer NOT NULL,
    monthly_price_vnd bigint NOT NULL,
    yearly_price_vnd bigint,
    room_limit integer NOT NULL,
    staff_limit integer NOT NULL,
    automation_quota integer NOT NULL,
    features jsonb DEFAULT '{}'::jsonb NOT NULL,
    effective_from timestamp with time zone DEFAULT now() NOT NULL,
    created_by_user_id uuid,
    reason text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT saas_plan_versions_automation_quota_check CHECK ((automation_quota >= 0)),
    CONSTRAINT saas_plan_versions_monthly_price_vnd_check CHECK ((monthly_price_vnd >= 0)),
    CONSTRAINT saas_plan_versions_room_limit_check CHECK ((room_limit >= 1)),
    CONSTRAINT saas_plan_versions_staff_limit_check CHECK ((staff_limit >= 1)),
    CONSTRAINT saas_plan_versions_version_check CHECK ((version >= 1)),
    CONSTRAINT saas_plan_versions_yearly_price_vnd_check CHECK (((yearly_price_vnd IS NULL) OR (yearly_price_vnd >= 0)))
);


--
-- Name: saas_plans; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.saas_plans (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    code text NOT NULL,
    name text NOT NULL,
    status text DEFAULT 'ACTIVE'::text NOT NULL,
    current_version_id uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT saas_plans_status_check CHECK ((status = ANY (ARRAY['ACTIVE'::text, 'ARCHIVED'::text])))
);


--
-- Name: saas_subscription_invoices; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.saas_subscription_invoices (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    organization_id uuid NOT NULL,
    subscription_id uuid NOT NULL,
    plan_id uuid NOT NULL,
    plan_version_id uuid NOT NULL,
    billing_interval text NOT NULL,
    period_start timestamp with time zone NOT NULL,
    period_end timestamp with time zone NOT NULL,
    amount_vnd bigint NOT NULL,
    status text DEFAULT 'OPEN'::text NOT NULL,
    issued_at timestamp with time zone DEFAULT now() NOT NULL,
    due_at timestamp with time zone NOT NULL,
    paid_at timestamp with time zone,
    void_reason text,
    voided_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    payment_reference text DEFAULT ('SAAS'::text || upper(replace((gen_random_uuid())::text, '-'::text, ''::text))) NOT NULL,
    CONSTRAINT saas_subscription_invoices_amount_vnd_check CHECK ((amount_vnd >= 0)),
    CONSTRAINT saas_subscription_invoices_billing_interval_check CHECK ((billing_interval = ANY (ARRAY['MONTHLY'::text, 'YEARLY'::text]))),
    CONSTRAINT saas_subscription_invoices_check CHECK ((period_end > period_start)),
    CONSTRAINT saas_subscription_invoices_check1 CHECK (((paid_at IS NULL) OR (status = 'PAID'::text))),
    CONSTRAINT saas_subscription_invoices_check2 CHECK ((((status = 'VOID'::text) AND (void_reason IS NOT NULL) AND (voided_at IS NOT NULL)) OR ((status <> 'VOID'::text) AND (void_reason IS NULL) AND (voided_at IS NULL)))),
    CONSTRAINT saas_subscription_invoices_status_check CHECK ((status = ANY (ARRAY['OPEN'::text, 'PARTIALLY_PAID'::text, 'PAID'::text, 'VOID'::text])))
);


--
-- Name: saas_subscription_payment_allocations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.saas_subscription_payment_allocations (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    organization_id uuid NOT NULL,
    payment_id uuid NOT NULL,
    invoice_id uuid NOT NULL,
    amount_vnd bigint NOT NULL,
    allocated_by_user_id uuid,
    reason text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT saas_subscription_payment_allocations_amount_vnd_check CHECK ((amount_vnd > 0))
);


--
-- Name: saas_subscription_payments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.saas_subscription_payments (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    organization_id uuid,
    subscription_id uuid,
    amount_vnd bigint NOT NULL,
    status text NOT NULL,
    reconciliation_status text DEFAULT 'UNALLOCATED'::text NOT NULL,
    source text NOT NULL,
    provider text,
    provider_transaction_id text,
    idempotency_key text NOT NULL,
    occurred_at timestamp with time zone NOT NULL,
    recorded_by_user_id uuid,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT saas_subscription_payments_amount_vnd_check CHECK ((amount_vnd > 0)),
    CONSTRAINT saas_subscription_payments_assignment_check CHECK ((((organization_id IS NULL) AND (subscription_id IS NULL)) OR ((organization_id IS NOT NULL) AND (subscription_id IS NOT NULL)))),
    CONSTRAINT saas_subscription_payments_reconciliation_status_check CHECK ((reconciliation_status = ANY (ARRAY['UNALLOCATED'::text, 'ALLOCATED'::text, 'REVIEW_REQUIRED'::text]))),
    CONSTRAINT saas_subscription_payments_source_check CHECK ((source = ANY (ARRAY['MANUAL'::text, 'PROVIDER'::text]))),
    CONSTRAINT saas_subscription_payments_status_check CHECK ((status = ANY (ARRAY['SUCCEEDED'::text, 'FAILED'::text, 'REFUNDED'::text])))
);


--
-- Name: system_settings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.system_settings (
    key text NOT NULL,
    group_key text NOT NULL,
    label text NOT NULL,
    description text DEFAULT ''::text NOT NULL,
    value jsonb NOT NULL,
    value_type text NOT NULL,
    version integer DEFAULT 1 NOT NULL,
    is_sensitive boolean DEFAULT false NOT NULL,
    updated_by_user_id uuid,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT system_settings_value_type_check CHECK ((value_type = ANY (ARRAY['BOOLEAN'::text, 'INTEGER'::text, 'STRING'::text, 'JSON'::text]))),
    CONSTRAINT system_settings_version_check CHECK ((version >= 1))
);


--
-- Name: system_worker_heartbeats; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.system_worker_heartbeats (
    worker_id text NOT NULL,
    role text NOT NULL,
    provider text,
    status text NOT NULL,
    stale_after_seconds integer NOT NULL,
    started_at timestamp with time zone DEFAULT now() NOT NULL,
    last_seen_at timestamp with time zone DEFAULT now() NOT NULL,
    last_error_code text,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT system_worker_heartbeats_role_check CHECK ((role = ANY (ARRAY['NOTIFICATION'::text, 'BILLING'::text, 'BILLING_WEBHOOK'::text, 'RENTER_PAYMENT_WEBHOOK'::text]))),
    CONSTRAINT system_worker_heartbeats_stale_after_seconds_check CHECK (((stale_after_seconds >= 30) AND (stale_after_seconds <= 86400))),
    CONSTRAINT system_worker_heartbeats_status_check CHECK ((status = ANY (ARRAY['STARTING'::text, 'HEALTHY'::text, 'DEGRADED'::text, 'STOPPING'::text])))
);


--
-- Name: user_auth_identities; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.user_auth_identities (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    provider text NOT NULL,
    provider_subject text NOT NULL,
    provider_email text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT user_auth_identities_provider_check CHECK ((provider = 'GOOGLE'::text))
);


--
-- Name: user_mfa_recovery_codes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.user_mfa_recovery_codes (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    code_hash bytea NOT NULL,
    used_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: user_passkeys; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.user_passkeys (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    credential_id text NOT NULL,
    public_key bytea NOT NULL,
    counter bigint DEFAULT 0 NOT NULL,
    transports text[] DEFAULT '{}'::text[] NOT NULL,
    device_type text NOT NULL,
    backed_up boolean DEFAULT false NOT NULL,
    name text DEFAULT 'Passkey'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    last_used_at timestamp with time zone,
    CONSTRAINT user_passkeys_counter_check CHECK ((counter >= 0))
);


--
-- Name: user_password_credentials; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.user_password_credentials (
    user_id uuid NOT NULL,
    password_hash bytea NOT NULL,
    password_salt bytea NOT NULL,
    scrypt_n integer NOT NULL,
    scrypt_r integer NOT NULL,
    scrypt_p integer NOT NULL,
    password_changed_at timestamp with time zone DEFAULT now() NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT user_password_credentials_scrypt_n_check CHECK ((scrypt_n >= 16384)),
    CONSTRAINT user_password_credentials_scrypt_p_check CHECK ((scrypt_p > 0)),
    CONSTRAINT user_password_credentials_scrypt_r_check CHECK ((scrypt_r > 0))
);


--
-- Name: user_totp_credentials; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.user_totp_credentials (
    user_id uuid NOT NULL,
    secret_ciphertext bytea NOT NULL,
    secret_iv bytea NOT NULL,
    secret_tag bytea NOT NULL,
    confirmed_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: users; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.users (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    email text NOT NULL,
    display_name text NOT NULL,
    status text DEFAULT 'ACTIVE'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    auth_version integer DEFAULT 1 NOT NULL,
    account_type text DEFAULT 'TENANT'::text NOT NULL,
    organization_id uuid,
    email_verified_at timestamp with time zone,
    CONSTRAINT users_account_tenant_scope_check CHECK ((((account_type = 'PLATFORM'::text) AND (organization_id IS NULL)) OR (account_type = 'TENANT'::text))),
    CONSTRAINT users_account_type_check CHECK ((account_type = ANY (ARRAY['TENANT'::text, 'PLATFORM'::text]))),
    CONSTRAINT users_auth_version_check CHECK ((auth_version > 0)),
    CONSTRAINT users_status_check CHECK ((status = ANY (ARRAY['ACTIVE'::text, 'SUSPENDED'::text])))
);


--
-- Name: administrative_areas administrative_areas_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.administrative_areas
    ADD CONSTRAINT administrative_areas_pkey PRIMARY KEY (id);


--
-- Name: audit_events audit_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.audit_events
    ADD CONSTRAINT audit_events_pkey PRIMARY KEY (id);


--
-- Name: auth_mfa_challenges auth_mfa_challenges_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.auth_mfa_challenges
    ADD CONSTRAINT auth_mfa_challenges_pkey PRIMARY KEY (id);


--
-- Name: auth_mfa_challenges auth_mfa_challenges_token_hash_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.auth_mfa_challenges
    ADD CONSTRAINT auth_mfa_challenges_token_hash_key UNIQUE (token_hash);


--
-- Name: auth_password_reset_tokens auth_password_reset_tokens_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.auth_password_reset_tokens
    ADD CONSTRAINT auth_password_reset_tokens_pkey PRIMARY KEY (id);


--
-- Name: auth_password_reset_tokens auth_password_reset_tokens_token_hash_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.auth_password_reset_tokens
    ADD CONSTRAINT auth_password_reset_tokens_token_hash_key UNIQUE (token_hash);


--
-- Name: auth_pending_registrations auth_pending_registrations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.auth_pending_registrations
    ADD CONSTRAINT auth_pending_registrations_pkey PRIMARY KEY (id);


--
-- Name: auth_pending_registrations auth_pending_registrations_token_hash_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.auth_pending_registrations
    ADD CONSTRAINT auth_pending_registrations_token_hash_key UNIQUE (token_hash);


--
-- Name: auth_rate_limit_buckets auth_rate_limit_buckets_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.auth_rate_limit_buckets
    ADD CONSTRAINT auth_rate_limit_buckets_pkey PRIMARY KEY (action, key_hash, window_start);


--
-- Name: auth_security_alerts auth_security_alerts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.auth_security_alerts
    ADD CONSTRAINT auth_security_alerts_pkey PRIMARY KEY (id);


--
-- Name: auth_security_alerts auth_security_alerts_source_event_id_alert_type_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.auth_security_alerts
    ADD CONSTRAINT auth_security_alerts_source_event_id_alert_type_key UNIQUE (source_event_id, alert_type);


--
-- Name: auth_security_events auth_security_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.auth_security_events
    ADD CONSTRAINT auth_security_events_pkey PRIMARY KEY (id);


--
-- Name: auth_sessions auth_sessions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.auth_sessions
    ADD CONSTRAINT auth_sessions_pkey PRIMARY KEY (id);


--
-- Name: auth_sessions auth_sessions_token_hash_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.auth_sessions
    ADD CONSTRAINT auth_sessions_token_hash_key UNIQUE (token_hash);


--
-- Name: auth_webauthn_challenges auth_webauthn_challenges_challenge_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.auth_webauthn_challenges
    ADD CONSTRAINT auth_webauthn_challenges_challenge_key UNIQUE (challenge);


--
-- Name: auth_webauthn_challenges auth_webauthn_challenges_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.auth_webauthn_challenges
    ADD CONSTRAINT auth_webauthn_challenges_pkey PRIMARY KEY (id);


--
-- Name: automation_quota_consumptions automation_quota_consumptions_organization_id_reservation_i_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.automation_quota_consumptions
    ADD CONSTRAINT automation_quota_consumptions_organization_id_reservation_i_key UNIQUE (organization_id, reservation_id, consumption_key);


--
-- Name: automation_quota_consumptions automation_quota_consumptions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.automation_quota_consumptions
    ADD CONSTRAINT automation_quota_consumptions_pkey PRIMARY KEY (id);


--
-- Name: automation_quota_periods automation_quota_periods_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.automation_quota_periods
    ADD CONSTRAINT automation_quota_periods_pkey PRIMARY KEY (organization_id, period_start);


--
-- Name: automation_quota_reservations automation_quota_reservations_organization_id_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.automation_quota_reservations
    ADD CONSTRAINT automation_quota_reservations_organization_id_id_key UNIQUE (organization_id, id);


--
-- Name: automation_quota_reservations automation_quota_reservations_organization_id_idempotency_k_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.automation_quota_reservations
    ADD CONSTRAINT automation_quota_reservations_organization_id_idempotency_k_key UNIQUE (organization_id, idempotency_key);


--
-- Name: automation_quota_reservations automation_quota_reservations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.automation_quota_reservations
    ADD CONSTRAINT automation_quota_reservations_pkey PRIMARY KEY (id);


--
-- Name: floors floors_organization_id_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.floors
    ADD CONSTRAINT floors_organization_id_id_key UNIQUE (organization_id, id);


--
-- Name: floors floors_organization_id_property_id_code_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.floors
    ADD CONSTRAINT floors_organization_id_property_id_code_key UNIQUE (organization_id, property_id, code);


--
-- Name: floors floors_organization_id_property_id_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.floors
    ADD CONSTRAINT floors_organization_id_property_id_id_key UNIQUE (organization_id, property_id, id);


--
-- Name: floors floors_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.floors
    ADD CONSTRAINT floors_pkey PRIMARY KEY (id);


--
-- Name: lease_amendments lease_amendments_number_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.lease_amendments
    ADD CONSTRAINT lease_amendments_number_unique UNIQUE (organization_id, lease_id, amendment_number);


--
-- Name: lease_amendments lease_amendments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.lease_amendments
    ADD CONSTRAINT lease_amendments_pkey PRIMARY KEY (id);


--
-- Name: lease_attachments lease_attachments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.lease_attachments
    ADD CONSTRAINT lease_attachments_pkey PRIMARY KEY (id);


--
-- Name: lease_command_receipts lease_command_receipts_organization_id_idempotency_key_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.lease_command_receipts
    ADD CONSTRAINT lease_command_receipts_organization_id_idempotency_key_key UNIQUE (organization_id, idempotency_key);


--
-- Name: lease_command_receipts lease_command_receipts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.lease_command_receipts
    ADD CONSTRAINT lease_command_receipts_pkey PRIMARY KEY (id);


--
-- Name: lease_deposit_entries lease_deposit_entries_organization_id_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.lease_deposit_entries
    ADD CONSTRAINT lease_deposit_entries_organization_id_id_key UNIQUE (organization_id, id);


--
-- Name: lease_deposit_entries lease_deposit_entries_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.lease_deposit_entries
    ADD CONSTRAINT lease_deposit_entries_pkey PRIMARY KEY (id);


--
-- Name: lease_residents lease_residents_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.lease_residents
    ADD CONSTRAINT lease_residents_pkey PRIMARY KEY (organization_id, lease_id, resident_id);


--
-- Name: lease_terminations lease_terminations_organization_id_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.lease_terminations
    ADD CONSTRAINT lease_terminations_organization_id_id_key UNIQUE (organization_id, id);


--
-- Name: lease_terminations lease_terminations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.lease_terminations
    ADD CONSTRAINT lease_terminations_pkey PRIMARY KEY (id);


--
-- Name: lease_vehicles lease_vehicles_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.lease_vehicles
    ADD CONSTRAINT lease_vehicles_pkey PRIMARY KEY (id);


--
-- Name: leases leases_organization_id_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.leases
    ADD CONSTRAINT leases_organization_id_id_key UNIQUE (organization_id, id);


--
-- Name: leases leases_organization_id_lease_code_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.leases
    ADD CONSTRAINT leases_organization_id_lease_code_key UNIQUE (organization_id, lease_code);


--
-- Name: leases leases_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.leases
    ADD CONSTRAINT leases_pkey PRIMARY KEY (id);


--
-- Name: maintenance_tickets maintenance_tickets_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.maintenance_tickets
    ADD CONSTRAINT maintenance_tickets_pkey PRIMARY KEY (id);


--
-- Name: membership_scopes membership_scopes_organization_id_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.membership_scopes
    ADD CONSTRAINT membership_scopes_organization_id_id_key UNIQUE (organization_id, id);


--
-- Name: membership_scopes membership_scopes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.membership_scopes
    ADD CONSTRAINT membership_scopes_pkey PRIMARY KEY (id);


--
-- Name: meter_readings meter_readings_organization_id_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.meter_readings
    ADD CONSTRAINT meter_readings_organization_id_id_key UNIQUE (organization_id, id);


--
-- Name: meter_readings meter_readings_organization_id_meter_id_reading_date_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.meter_readings
    ADD CONSTRAINT meter_readings_organization_id_meter_id_reading_date_key UNIQUE (organization_id, meter_id, reading_date);


--
-- Name: meter_readings meter_readings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.meter_readings
    ADD CONSTRAINT meter_readings_pkey PRIMARY KEY (id);


--
-- Name: meters meters_organization_id_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.meters
    ADD CONSTRAINT meters_organization_id_id_key UNIQUE (organization_id, id);


--
-- Name: meters meters_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.meters
    ADD CONSTRAINT meters_pkey PRIMARY KEY (id);


--
-- Name: notification_attempts notification_attempts_organization_id_job_id_attempt_number_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notification_attempts
    ADD CONSTRAINT notification_attempts_organization_id_job_id_attempt_number_key UNIQUE (organization_id, job_id, attempt_number);


--
-- Name: notification_attempts notification_attempts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notification_attempts
    ADD CONSTRAINT notification_attempts_pkey PRIMARY KEY (id);


--
-- Name: notification_campaigns notification_campaigns_organization_id_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notification_campaigns
    ADD CONSTRAINT notification_campaigns_organization_id_id_key UNIQUE (organization_id, id);


--
-- Name: notification_campaigns notification_campaigns_organization_id_idempotency_key_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notification_campaigns
    ADD CONSTRAINT notification_campaigns_organization_id_idempotency_key_key UNIQUE (organization_id, idempotency_key);


--
-- Name: notification_campaigns notification_campaigns_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notification_campaigns
    ADD CONSTRAINT notification_campaigns_pkey PRIMARY KEY (id);


--
-- Name: notification_jobs notification_jobs_organization_id_campaign_id_recipient_key_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notification_jobs
    ADD CONSTRAINT notification_jobs_organization_id_campaign_id_recipient_key_key UNIQUE (organization_id, campaign_id, recipient_key);


--
-- Name: notification_jobs notification_jobs_organization_id_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notification_jobs
    ADD CONSTRAINT notification_jobs_organization_id_id_key UNIQUE (organization_id, id);


--
-- Name: notification_jobs notification_jobs_organization_id_idempotency_key_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notification_jobs
    ADD CONSTRAINT notification_jobs_organization_id_idempotency_key_key UNIQUE (organization_id, idempotency_key);


--
-- Name: notification_jobs notification_jobs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notification_jobs
    ADD CONSTRAINT notification_jobs_pkey PRIMARY KEY (id);


--
-- Name: notification_provider_controls notification_provider_controls_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notification_provider_controls
    ADD CONSTRAINT notification_provider_controls_pkey PRIMARY KEY (provider);


--
-- Name: notification_worker_heartbeats notification_worker_heartbeats_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notification_worker_heartbeats
    ADD CONSTRAINT notification_worker_heartbeats_pkey PRIMARY KEY (worker_id);


--
-- Name: operating_expenses operating_expenses_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.operating_expenses
    ADD CONSTRAINT operating_expenses_pkey PRIMARY KEY (id);


--
-- Name: operational_groups operational_groups_organization_id_code_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.operational_groups
    ADD CONSTRAINT operational_groups_organization_id_code_key UNIQUE (organization_id, code);


--
-- Name: operational_groups operational_groups_organization_id_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.operational_groups
    ADD CONSTRAINT operational_groups_organization_id_id_key UNIQUE (organization_id, id);


--
-- Name: operational_groups operational_groups_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.operational_groups
    ADD CONSTRAINT operational_groups_pkey PRIMARY KEY (id);


--
-- Name: organization_entitlement_overrides organization_entitlement_overrides_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.organization_entitlement_overrides
    ADD CONSTRAINT organization_entitlement_overrides_pkey PRIMARY KEY (id);


--
-- Name: organization_memberships organization_memberships_organization_id_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.organization_memberships
    ADD CONSTRAINT organization_memberships_organization_id_id_key UNIQUE (organization_id, id);


--
-- Name: organization_memberships organization_memberships_organization_id_user_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.organization_memberships
    ADD CONSTRAINT organization_memberships_organization_id_user_id_key UNIQUE (organization_id, user_id);


--
-- Name: organization_memberships organization_memberships_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.organization_memberships
    ADD CONSTRAINT organization_memberships_pkey PRIMARY KEY (id);


--
-- Name: organization_payment_profiles organization_payment_profiles_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.organization_payment_profiles
    ADD CONSTRAINT organization_payment_profiles_pkey PRIMARY KEY (organization_id);


--
-- Name: organization_subscriptions organization_subscriptions_organization_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.organization_subscriptions
    ADD CONSTRAINT organization_subscriptions_organization_id_key UNIQUE (organization_id);


--
-- Name: organization_subscriptions organization_subscriptions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.organization_subscriptions
    ADD CONSTRAINT organization_subscriptions_pkey PRIMARY KEY (id);


--
-- Name: organizations organizations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.organizations
    ADD CONSTRAINT organizations_pkey PRIMARY KEY (id);


--
-- Name: organizations organizations_slug_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.organizations
    ADD CONSTRAINT organizations_slug_key UNIQUE (slug);


--
-- Name: platform_audit_events platform_audit_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.platform_audit_events
    ADD CONSTRAINT platform_audit_events_pkey PRIMARY KEY (id);


--
-- Name: platform_command_receipts platform_command_receipts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.platform_command_receipts
    ADD CONSTRAINT platform_command_receipts_pkey PRIMARY KEY (actor_user_id, idempotency_key);


--
-- Name: platform_operators platform_operators_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.platform_operators
    ADD CONSTRAINT platform_operators_pkey PRIMARY KEY (user_id);


--
-- Name: pricing_policies pricing_policies_organization_id_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pricing_policies
    ADD CONSTRAINT pricing_policies_organization_id_id_key UNIQUE (organization_id, id);


--
-- Name: pricing_policies pricing_policies_organization_id_property_id_effective_from_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pricing_policies
    ADD CONSTRAINT pricing_policies_organization_id_property_id_effective_from_key UNIQUE (organization_id, property_id, effective_from);


--
-- Name: pricing_policies pricing_policies_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pricing_policies
    ADD CONSTRAINT pricing_policies_pkey PRIMARY KEY (id);


--
-- Name: pricing_policy_items pricing_policy_items_organization_id_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pricing_policy_items
    ADD CONSTRAINT pricing_policy_items_organization_id_id_key UNIQUE (organization_id, id);


--
-- Name: pricing_policy_items pricing_policy_items_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pricing_policy_items
    ADD CONSTRAINT pricing_policy_items_pkey PRIMARY KEY (id);


--
-- Name: properties properties_organization_id_code_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.properties
    ADD CONSTRAINT properties_organization_id_code_key UNIQUE (organization_id, code);


--
-- Name: properties properties_organization_id_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.properties
    ADD CONSTRAINT properties_organization_id_id_key UNIQUE (organization_id, id);


--
-- Name: properties properties_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.properties
    ADD CONSTRAINT properties_pkey PRIMARY KEY (id);


--
-- Name: property_operational_groups property_operational_groups_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.property_operational_groups
    ADD CONSTRAINT property_operational_groups_pkey PRIMARY KEY (organization_id, property_id, operational_group_id);


--
-- Name: renter_billing_cycles renter_billing_cycles_organization_id_cycle_code_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.renter_billing_cycles
    ADD CONSTRAINT renter_billing_cycles_organization_id_cycle_code_key UNIQUE (organization_id, cycle_code);


--
-- Name: renter_billing_cycles renter_billing_cycles_organization_id_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.renter_billing_cycles
    ADD CONSTRAINT renter_billing_cycles_organization_id_id_key UNIQUE (organization_id, id);


--
-- Name: renter_billing_cycles renter_billing_cycles_organization_id_property_id_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.renter_billing_cycles
    ADD CONSTRAINT renter_billing_cycles_organization_id_property_id_id_key UNIQUE (organization_id, property_id, id);


--
-- Name: renter_billing_cycles renter_billing_cycles_organization_id_property_id_period_st_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.renter_billing_cycles
    ADD CONSTRAINT renter_billing_cycles_organization_id_property_id_period_st_key UNIQUE (organization_id, property_id, period_start, period_end);


--
-- Name: renter_billing_cycles renter_billing_cycles_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.renter_billing_cycles
    ADD CONSTRAINT renter_billing_cycles_pkey PRIMARY KEY (id);


--
-- Name: renter_credit_balances renter_credit_balances_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.renter_credit_balances
    ADD CONSTRAINT renter_credit_balances_pkey PRIMARY KEY (organization_id);


--
-- Name: renter_credit_movements renter_credit_movements_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.renter_credit_movements
    ADD CONSTRAINT renter_credit_movements_pkey PRIMARY KEY (id);


--
-- Name: renter_invoice_adjustments renter_invoice_adjustments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.renter_invoice_adjustments
    ADD CONSTRAINT renter_invoice_adjustments_pkey PRIMARY KEY (id);


--
-- Name: renter_invoice_lines renter_invoice_lines_organization_id_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.renter_invoice_lines
    ADD CONSTRAINT renter_invoice_lines_organization_id_id_key UNIQUE (organization_id, id);


--
-- Name: renter_invoice_lines renter_invoice_lines_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.renter_invoice_lines
    ADD CONSTRAINT renter_invoice_lines_pkey PRIMARY KEY (id);


--
-- Name: renter_invoice_public_links renter_invoice_public_links_organization_id_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.renter_invoice_public_links
    ADD CONSTRAINT renter_invoice_public_links_organization_id_id_key UNIQUE (organization_id, id);


--
-- Name: renter_invoice_public_links renter_invoice_public_links_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.renter_invoice_public_links
    ADD CONSTRAINT renter_invoice_public_links_pkey PRIMARY KEY (id);


--
-- Name: renter_invoice_public_links renter_invoice_public_links_token_hash_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.renter_invoice_public_links
    ADD CONSTRAINT renter_invoice_public_links_token_hash_key UNIQUE (token_hash);


--
-- Name: renter_invoice_reminders renter_invoice_reminders_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.renter_invoice_reminders
    ADD CONSTRAINT renter_invoice_reminders_pkey PRIMARY KEY (id);


--
-- Name: renter_invoices renter_invoices_organization_id_billing_cycle_id_lease_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.renter_invoices
    ADD CONSTRAINT renter_invoices_organization_id_billing_cycle_id_lease_id_key UNIQUE (organization_id, billing_cycle_id, lease_id);


--
-- Name: renter_invoices renter_invoices_organization_id_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.renter_invoices
    ADD CONSTRAINT renter_invoices_organization_id_id_key UNIQUE (organization_id, id);


--
-- Name: renter_invoices renter_invoices_organization_id_invoice_number_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.renter_invoices
    ADD CONSTRAINT renter_invoices_organization_id_invoice_number_key UNIQUE (organization_id, invoice_number);


--
-- Name: renter_invoices renter_invoices_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.renter_invoices
    ADD CONSTRAINT renter_invoices_pkey PRIMARY KEY (id);


--
-- Name: renter_payment_allocations renter_payment_allocations_organization_id_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.renter_payment_allocations
    ADD CONSTRAINT renter_payment_allocations_organization_id_id_key UNIQUE (organization_id, id);


--
-- Name: renter_payment_allocations renter_payment_allocations_organization_id_payment_transact_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.renter_payment_allocations
    ADD CONSTRAINT renter_payment_allocations_organization_id_payment_transact_key UNIQUE (organization_id, payment_transaction_id, invoice_id);


--
-- Name: renter_payment_allocations renter_payment_allocations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.renter_payment_allocations
    ADD CONSTRAINT renter_payment_allocations_pkey PRIMARY KEY (id);


--
-- Name: renter_payment_reconciliation_cursors renter_payment_reconciliation_cursors_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.renter_payment_reconciliation_cursors
    ADD CONSTRAINT renter_payment_reconciliation_cursors_pkey PRIMARY KEY (provider, scope_key);


--
-- Name: renter_payment_transactions renter_payment_transactions_organization_id_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.renter_payment_transactions
    ADD CONSTRAINT renter_payment_transactions_organization_id_id_key UNIQUE (organization_id, id);


--
-- Name: renter_payment_transactions renter_payment_transactions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.renter_payment_transactions
    ADD CONSTRAINT renter_payment_transactions_pkey PRIMARY KEY (id);


--
-- Name: renter_payment_webhook_events renter_payment_webhook_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.renter_payment_webhook_events
    ADD CONSTRAINT renter_payment_webhook_events_pkey PRIMARY KEY (id);


--
-- Name: renter_payment_webhook_events renter_payment_webhook_events_provider_provider_event_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.renter_payment_webhook_events
    ADD CONSTRAINT renter_payment_webhook_events_provider_provider_event_id_key UNIQUE (provider, provider_event_id);


--
-- Name: renter_provider_transaction_aliases renter_provider_transaction_a_provider_alias_type_alias_val_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.renter_provider_transaction_aliases
    ADD CONSTRAINT renter_provider_transaction_a_provider_alias_type_alias_val_key UNIQUE (provider, alias_type, alias_value);


--
-- Name: renter_provider_transaction_aliases renter_provider_transaction_aliases_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.renter_provider_transaction_aliases
    ADD CONSTRAINT renter_provider_transaction_aliases_pkey PRIMARY KEY (id);


--
-- Name: renter_provider_transaction_identities renter_provider_transaction_i_provider_canonical_fingerprin_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.renter_provider_transaction_identities
    ADD CONSTRAINT renter_provider_transaction_i_provider_canonical_fingerprin_key UNIQUE (provider, canonical_fingerprint);


--
-- Name: renter_provider_transaction_identities renter_provider_transaction_identiti_payment_transaction_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.renter_provider_transaction_identities
    ADD CONSTRAINT renter_provider_transaction_identiti_payment_transaction_id_key UNIQUE (payment_transaction_id);


--
-- Name: renter_provider_transaction_identities renter_provider_transaction_identities_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.renter_provider_transaction_identities
    ADD CONSTRAINT renter_provider_transaction_identities_pkey PRIMARY KEY (id);


--
-- Name: renter_provider_transaction_identities renter_provider_transaction_identities_provider_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.renter_provider_transaction_identities
    ADD CONSTRAINT renter_provider_transaction_identities_provider_id_key UNIQUE (provider, id);


--
-- Name: renter_refunds renter_refunds_organization_id_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.renter_refunds
    ADD CONSTRAINT renter_refunds_organization_id_id_key UNIQUE (organization_id, id);


--
-- Name: renter_refunds renter_refunds_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.renter_refunds
    ADD CONSTRAINT renter_refunds_pkey PRIMARY KEY (id);


--
-- Name: residents residents_organization_id_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.residents
    ADD CONSTRAINT residents_organization_id_id_key UNIQUE (organization_id, id);


--
-- Name: residents residents_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.residents
    ADD CONSTRAINT residents_pkey PRIMARY KEY (id);


--
-- Name: room_equipment room_equipment_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.room_equipment
    ADD CONSTRAINT room_equipment_pkey PRIMARY KEY (id);


--
-- Name: room_reservations room_reservations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.room_reservations
    ADD CONSTRAINT room_reservations_pkey PRIMARY KEY (id);


--
-- Name: rooms rooms_organization_id_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.rooms
    ADD CONSTRAINT rooms_organization_id_id_key UNIQUE (organization_id, id);


--
-- Name: rooms rooms_organization_id_property_id_code_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.rooms
    ADD CONSTRAINT rooms_organization_id_property_id_code_key UNIQUE (organization_id, property_id, code);


--
-- Name: rooms rooms_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.rooms
    ADD CONSTRAINT rooms_pkey PRIMARY KEY (id);


--
-- Name: saas_billing_webhook_events saas_billing_webhook_events_payment_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.saas_billing_webhook_events
    ADD CONSTRAINT saas_billing_webhook_events_payment_id_key UNIQUE (payment_id);


--
-- Name: saas_billing_webhook_events saas_billing_webhook_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.saas_billing_webhook_events
    ADD CONSTRAINT saas_billing_webhook_events_pkey PRIMARY KEY (id);


--
-- Name: saas_billing_webhook_events saas_billing_webhook_events_provider_provider_event_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.saas_billing_webhook_events
    ADD CONSTRAINT saas_billing_webhook_events_provider_provider_event_id_key UNIQUE (provider, provider_event_id);


--
-- Name: saas_plan_versions saas_plan_versions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.saas_plan_versions
    ADD CONSTRAINT saas_plan_versions_pkey PRIMARY KEY (id);


--
-- Name: saas_plan_versions saas_plan_versions_plan_id_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.saas_plan_versions
    ADD CONSTRAINT saas_plan_versions_plan_id_id_key UNIQUE (plan_id, id);


--
-- Name: saas_plan_versions saas_plan_versions_plan_id_version_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.saas_plan_versions
    ADD CONSTRAINT saas_plan_versions_plan_id_version_key UNIQUE (plan_id, version);


--
-- Name: saas_plans saas_plans_code_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.saas_plans
    ADD CONSTRAINT saas_plans_code_key UNIQUE (code);


--
-- Name: saas_plans saas_plans_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.saas_plans
    ADD CONSTRAINT saas_plans_pkey PRIMARY KEY (id);


--
-- Name: saas_subscription_invoices saas_subscription_invoices_organization_id_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.saas_subscription_invoices
    ADD CONSTRAINT saas_subscription_invoices_organization_id_id_key UNIQUE (organization_id, id);


--
-- Name: saas_subscription_invoices saas_subscription_invoices_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.saas_subscription_invoices
    ADD CONSTRAINT saas_subscription_invoices_pkey PRIMARY KEY (id);


--
-- Name: saas_subscription_invoices saas_subscription_invoices_subscription_id_period_start_per_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.saas_subscription_invoices
    ADD CONSTRAINT saas_subscription_invoices_subscription_id_period_start_per_key UNIQUE (subscription_id, period_start, period_end);


--
-- Name: saas_subscription_payment_allocations saas_subscription_payment_allocations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.saas_subscription_payment_allocations
    ADD CONSTRAINT saas_subscription_payment_allocations_pkey PRIMARY KEY (id);


--
-- Name: saas_subscription_payments saas_subscription_payments_organization_id_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.saas_subscription_payments
    ADD CONSTRAINT saas_subscription_payments_organization_id_id_key UNIQUE (organization_id, id);


--
-- Name: saas_subscription_payments saas_subscription_payments_organization_id_idempotency_key_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.saas_subscription_payments
    ADD CONSTRAINT saas_subscription_payments_organization_id_idempotency_key_key UNIQUE (organization_id, idempotency_key);


--
-- Name: saas_subscription_payments saas_subscription_payments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.saas_subscription_payments
    ADD CONSTRAINT saas_subscription_payments_pkey PRIMARY KEY (id);


--
-- Name: system_settings system_settings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.system_settings
    ADD CONSTRAINT system_settings_pkey PRIMARY KEY (key);


--
-- Name: system_worker_heartbeats system_worker_heartbeats_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.system_worker_heartbeats
    ADD CONSTRAINT system_worker_heartbeats_pkey PRIMARY KEY (worker_id);


--
-- Name: user_auth_identities user_auth_identities_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_auth_identities
    ADD CONSTRAINT user_auth_identities_pkey PRIMARY KEY (id);


--
-- Name: user_auth_identities user_auth_identities_provider_provider_subject_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_auth_identities
    ADD CONSTRAINT user_auth_identities_provider_provider_subject_key UNIQUE (provider, provider_subject);


--
-- Name: user_auth_identities user_auth_identities_user_id_provider_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_auth_identities
    ADD CONSTRAINT user_auth_identities_user_id_provider_key UNIQUE (user_id, provider);


--
-- Name: user_mfa_recovery_codes user_mfa_recovery_codes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_mfa_recovery_codes
    ADD CONSTRAINT user_mfa_recovery_codes_pkey PRIMARY KEY (id);


--
-- Name: user_mfa_recovery_codes user_mfa_recovery_codes_user_id_code_hash_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_mfa_recovery_codes
    ADD CONSTRAINT user_mfa_recovery_codes_user_id_code_hash_key UNIQUE (user_id, code_hash);


--
-- Name: user_passkeys user_passkeys_credential_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_passkeys
    ADD CONSTRAINT user_passkeys_credential_id_key UNIQUE (credential_id);


--
-- Name: user_passkeys user_passkeys_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_passkeys
    ADD CONSTRAINT user_passkeys_pkey PRIMARY KEY (id);


--
-- Name: user_password_credentials user_password_credentials_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_password_credentials
    ADD CONSTRAINT user_password_credentials_pkey PRIMARY KEY (user_id);


--
-- Name: user_totp_credentials user_totp_credentials_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_totp_credentials
    ADD CONSTRAINT user_totp_credentials_pkey PRIMARY KEY (user_id);


--
-- Name: users users_organization_id_id_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_organization_id_id_unique UNIQUE (organization_id, id);


--
-- Name: users users_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_pkey PRIMARY KEY (id);


--
-- Name: administrative_areas_parent_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX administrative_areas_parent_idx ON public.administrative_areas USING btree (parent_id, is_active);


--
-- Name: administrative_areas_type_code_uidx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX administrative_areas_type_code_uidx ON public.administrative_areas USING btree (area_type, code) WHERE (code IS NOT NULL);


--
-- Name: audit_events_org_resource_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX audit_events_org_resource_idx ON public.audit_events USING btree (organization_id, resource_id, occurred_at DESC);


--
-- Name: audit_events_org_time_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX audit_events_org_time_idx ON public.audit_events USING btree (organization_id, occurred_at DESC, id);


--
-- Name: audit_events_resource_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX audit_events_resource_idx ON public.audit_events USING btree (organization_id, resource_type, resource_id, occurred_at DESC);


--
-- Name: auth_mfa_challenges_purpose_active_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX auth_mfa_challenges_purpose_active_idx ON public.auth_mfa_challenges USING btree (user_id, purpose, expires_at) WHERE (consumed_at IS NULL);


--
-- Name: auth_mfa_challenges_user_active_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX auth_mfa_challenges_user_active_idx ON public.auth_mfa_challenges USING btree (user_id, expires_at) WHERE (consumed_at IS NULL);


--
-- Name: auth_password_reset_tokens_expiry_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX auth_password_reset_tokens_expiry_idx ON public.auth_password_reset_tokens USING btree (expires_at) WHERE (consumed_at IS NULL);


--
-- Name: auth_password_reset_tokens_user_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX auth_password_reset_tokens_user_idx ON public.auth_password_reset_tokens USING btree (user_id, created_at DESC);


--
-- Name: auth_pending_registrations_email_ci_uidx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX auth_pending_registrations_email_ci_uidx ON public.auth_pending_registrations USING btree (lower(email));


--
-- Name: auth_pending_registrations_expiry_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX auth_pending_registrations_expiry_idx ON public.auth_pending_registrations USING btree (expires_at) WHERE (consumed_at IS NULL);


--
-- Name: auth_rate_limit_buckets_updated_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX auth_rate_limit_buckets_updated_at_idx ON public.auth_rate_limit_buckets USING btree (updated_at);


--
-- Name: auth_security_alerts_created_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX auth_security_alerts_created_idx ON public.auth_security_alerts USING btree (created_at DESC);


--
-- Name: auth_security_alerts_delivery_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX auth_security_alerts_delivery_idx ON public.auth_security_alerts USING btree (delivery_status, created_at) WHERE (delivery_status = ANY (ARRAY['PENDING'::text, 'FAILED'::text]));


--
-- Name: auth_security_alerts_user_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX auth_security_alerts_user_idx ON public.auth_security_alerts USING btree (user_id, created_at DESC) WHERE (user_id IS NOT NULL);


--
-- Name: auth_security_events_occurred_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX auth_security_events_occurred_at_idx ON public.auth_security_events USING btree (occurred_at DESC);


--
-- Name: auth_security_events_organization_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX auth_security_events_organization_idx ON public.auth_security_events USING btree (organization_id, occurred_at DESC) WHERE (organization_id IS NOT NULL);


--
-- Name: auth_security_events_user_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX auth_security_events_user_idx ON public.auth_security_events USING btree (user_id, occurred_at DESC) WHERE (user_id IS NOT NULL);


--
-- Name: auth_sessions_expiry_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX auth_sessions_expiry_idx ON public.auth_sessions USING btree (expires_at) WHERE (revoked_at IS NULL);


--
-- Name: auth_sessions_org_user_active_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX auth_sessions_org_user_active_idx ON public.auth_sessions USING btree (organization_id, user_id, expires_at DESC) WHERE (revoked_at IS NULL);


--
-- Name: auth_sessions_reauthenticated_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX auth_sessions_reauthenticated_idx ON public.auth_sessions USING btree (user_id, reauthenticated_at DESC) WHERE (revoked_at IS NULL);


--
-- Name: auth_sessions_user_active_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX auth_sessions_user_active_idx ON public.auth_sessions USING btree (user_id, expires_at DESC, id) WHERE (revoked_at IS NULL);


--
-- Name: auth_webauthn_challenges_user_active_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX auth_webauthn_challenges_user_active_idx ON public.auth_webauthn_challenges USING btree (user_id, purpose, expires_at) WHERE (consumed_at IS NULL);


--
-- Name: auth_webauthn_passwordless_active_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX auth_webauthn_passwordless_active_idx ON public.auth_webauthn_challenges USING btree (purpose, expires_at, created_at DESC) WHERE ((consumed_at IS NULL) AND (purpose = ANY (ARRAY['PASSWORDLESS_TENANT'::text, 'PASSWORDLESS_PLATFORM'::text])));


--
-- Name: automation_quota_consumptions_reservation_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX automation_quota_consumptions_reservation_idx ON public.automation_quota_consumptions USING btree (organization_id, reservation_id, created_at);


--
-- Name: automation_quota_periods_current_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX automation_quota_periods_current_idx ON public.automation_quota_periods USING btree (organization_id, period_end DESC, period_start DESC);


--
-- Name: automation_quota_reservations_period_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX automation_quota_reservations_period_idx ON public.automation_quota_reservations USING btree (organization_id, period_start, status, created_at DESC);


--
-- Name: floors_property_order_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX floors_property_order_idx ON public.floors USING btree (organization_id, property_id, sort_order, id);


--
-- Name: lease_amendments_org_lease_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX lease_amendments_org_lease_idx ON public.lease_amendments USING btree (organization_id, lease_id, effective_date DESC);


--
-- Name: lease_attachments_org_lease_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX lease_attachments_org_lease_idx ON public.lease_attachments USING btree (organization_id, lease_id, uploaded_at DESC);


--
-- Name: lease_command_receipts_lease_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX lease_command_receipts_lease_idx ON public.lease_command_receipts USING btree (organization_id, lease_id, created_at DESC) WHERE (lease_id IS NOT NULL);


--
-- Name: lease_deposit_entries_lease_history_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX lease_deposit_entries_lease_history_idx ON public.lease_deposit_entries USING btree (organization_id, lease_id, occurred_at DESC, created_at DESC, id);


--
-- Name: lease_residents_occupancy_lookup_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX lease_residents_occupancy_lookup_idx ON public.lease_residents USING btree (organization_id, lease_id, joined_on, left_on);


--
-- Name: lease_residents_one_primary_uidx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX lease_residents_one_primary_uidx ON public.lease_residents USING btree (organization_id, lease_id) WHERE ((party_role = 'PRIMARY_TENANT'::text) AND (left_on IS NULL));


--
-- Name: lease_residents_resident_history_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX lease_residents_resident_history_idx ON public.lease_residents USING btree (organization_id, resident_id, joined_on DESC, lease_id);


--
-- Name: lease_terminations_one_open_uidx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX lease_terminations_one_open_uidx ON public.lease_terminations USING btree (organization_id, lease_id) WHERE (status = ANY (ARRAY['SCHEDULED'::text, 'READY'::text]));


--
-- Name: lease_terminations_readiness_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX lease_terminations_readiness_idx ON public.lease_terminations USING btree (organization_id, status, meter_readiness, financial_readiness, deposit_readiness, effective_date);


--
-- Name: lease_vehicles_org_active_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX lease_vehicles_org_active_idx ON public.lease_vehicles USING btree (organization_id, is_active, registered_at);


--
-- Name: lease_vehicles_org_lease_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX lease_vehicles_org_lease_idx ON public.lease_vehicles USING btree (organization_id, lease_id, is_active, registered_at);


--
-- Name: leases_dashboard_expiry_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX leases_dashboard_expiry_idx ON public.leases USING btree (planned_end_date, organization_id) WHERE ((planned_end_date IS NOT NULL) AND (status = ANY (ARRAY['ACTIVE'::text, 'TERMINATION_SCHEDULED'::text])));


--
-- Name: leases_one_current_per_room_uidx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX leases_one_current_per_room_uidx ON public.leases USING btree (organization_id, room_id) WHERE (status = ANY (ARRAY['ACTIVE'::text, 'TERMINATION_SCHEDULED'::text]));


--
-- Name: leases_renewed_from_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX leases_renewed_from_idx ON public.leases USING btree (organization_id, renewed_from_lease_id) WHERE (renewed_from_lease_id IS NOT NULL);


--
-- Name: leases_room_history_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX leases_room_history_idx ON public.leases USING btree (organization_id, room_id, start_date DESC, id);


--
-- Name: leases_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX leases_status_idx ON public.leases USING btree (organization_id, status, start_date, id);


--
-- Name: maintenance_tickets_org_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX maintenance_tickets_org_status_idx ON public.maintenance_tickets USING btree (organization_id, status, reported_at DESC);


--
-- Name: maintenance_tickets_property_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX maintenance_tickets_property_idx ON public.maintenance_tickets USING btree (organization_id, property_id, reported_at DESC);


--
-- Name: maintenance_tickets_room_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX maintenance_tickets_room_idx ON public.maintenance_tickets USING btree (organization_id, room_id, reported_at DESC);


--
-- Name: membership_scopes_identity_uidx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX membership_scopes_identity_uidx ON public.membership_scopes USING btree (membership_id, scope_type, COALESCE(operational_group_id, '00000000-0000-0000-0000-000000000000'::uuid), COALESCE(property_id, '00000000-0000-0000-0000-000000000000'::uuid));


--
-- Name: membership_scopes_membership_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX membership_scopes_membership_idx ON public.membership_scopes USING btree (organization_id, membership_id, scope_type);


--
-- Name: meter_readings_meter_date_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX meter_readings_meter_date_idx ON public.meter_readings USING btree (organization_id, meter_id, reading_date DESC, id);


--
-- Name: meters_one_active_type_per_room_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX meters_one_active_type_per_room_idx ON public.meters USING btree (organization_id, room_id, meter_type) WHERE (is_active = true);


--
-- Name: meters_org_active_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX meters_org_active_idx ON public.meters USING btree (organization_id, is_active, room_id);


--
-- Name: meters_room_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX meters_room_idx ON public.meters USING btree (organization_id, room_id, meter_type, is_active, id);


--
-- Name: notification_attempts_job_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX notification_attempts_job_idx ON public.notification_attempts USING btree (organization_id, job_id, attempt_number DESC);


--
-- Name: notification_campaigns_source_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX notification_campaigns_source_idx ON public.notification_campaigns USING btree (organization_id, source_type, source_id, created_at DESC) WHERE (source_type IS NOT NULL);


--
-- Name: notification_campaigns_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX notification_campaigns_status_idx ON public.notification_campaigns USING btree (organization_id, status, created_at DESC);


--
-- Name: notification_jobs_campaign_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX notification_jobs_campaign_idx ON public.notification_jobs USING btree (organization_id, campaign_id, status, created_at);


--
-- Name: notification_jobs_claim_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX notification_jobs_claim_idx ON public.notification_jobs USING btree (provider, status, next_attempt_at, updated_at, created_at) WHERE (status = ANY (ARRAY['QUEUED'::text, 'RETRY_WAIT'::text, 'RUNNING'::text]));


--
-- Name: notification_worker_heartbeats_provider_seen_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX notification_worker_heartbeats_provider_seen_idx ON public.notification_worker_heartbeats USING btree (provider, last_seen_at DESC);


--
-- Name: operating_expenses_category_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX operating_expenses_category_idx ON public.operating_expenses USING btree (organization_id, category, occurred_at DESC);


--
-- Name: operating_expenses_org_occurred_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX operating_expenses_org_occurred_idx ON public.operating_expenses USING btree (organization_id, occurred_at DESC, id);


--
-- Name: operating_expenses_property_occurred_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX operating_expenses_property_occurred_idx ON public.operating_expenses USING btree (organization_id, property_id, occurred_at DESC, id);


--
-- Name: organization_entitlement_overrides_active_uidx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX organization_entitlement_overrides_active_uidx ON public.organization_entitlement_overrides USING btree (organization_id, entitlement_key) WHERE (revoked_at IS NULL);


--
-- Name: organization_entitlement_overrides_org_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX organization_entitlement_overrides_org_idx ON public.organization_entitlement_overrides USING btree (organization_id, entitlement_key, created_at DESC);


--
-- Name: organization_memberships_user_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX organization_memberships_user_idx ON public.organization_memberships USING btree (user_id, status);


--
-- Name: organization_subscriptions_org_id_uidx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX organization_subscriptions_org_id_uidx ON public.organization_subscriptions USING btree (organization_id, id);


--
-- Name: organization_subscriptions_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX organization_subscriptions_status_idx ON public.organization_subscriptions USING btree (status, current_period_end);


--
-- Name: platform_audit_events_org_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX platform_audit_events_org_idx ON public.platform_audit_events USING btree (organization_id, occurred_at DESC) WHERE (organization_id IS NOT NULL);


--
-- Name: platform_audit_events_target_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX platform_audit_events_target_idx ON public.platform_audit_events USING btree (target_type, target_key, occurred_at DESC);


--
-- Name: platform_audit_events_time_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX platform_audit_events_time_idx ON public.platform_audit_events USING btree (occurred_at DESC, id);


--
-- Name: platform_command_receipts_created_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX platform_command_receipts_created_idx ON public.platform_command_receipts USING btree (created_at DESC);


--
-- Name: pricing_policies_property_effective_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX pricing_policies_property_effective_idx ON public.pricing_policies USING btree (organization_id, property_id, effective_from DESC, effective_to, id);


--
-- Name: pricing_policy_items_policy_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX pricing_policy_items_policy_idx ON public.pricing_policy_items USING btree (organization_id, policy_id, sort_order, id);


--
-- Name: properties_area_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX properties_area_idx ON public.properties USING btree (organization_id, administrative_area_id, is_active);


--
-- Name: properties_dashboard_active_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX properties_dashboard_active_idx ON public.properties USING btree (organization_id, id) WHERE (is_active = true);


--
-- Name: property_operational_groups_group_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX property_operational_groups_group_idx ON public.property_operational_groups USING btree (organization_id, operational_group_id, property_id);


--
-- Name: renter_billing_cycles_property_period_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX renter_billing_cycles_property_period_idx ON public.renter_billing_cycles USING btree (organization_id, property_id, period_start DESC, period_end DESC, id);


--
-- Name: renter_credit_movements_invoice_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX renter_credit_movements_invoice_idx ON public.renter_credit_movements USING btree (organization_id, invoice_id) WHERE (invoice_id IS NOT NULL);


--
-- Name: renter_credit_movements_org_time_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX renter_credit_movements_org_time_idx ON public.renter_credit_movements USING btree (organization_id, created_at DESC, id);


--
-- Name: renter_invoice_adjustments_org_invoice_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX renter_invoice_adjustments_org_invoice_idx ON public.renter_invoice_adjustments USING btree (organization_id, invoice_id, created_at);


--
-- Name: renter_invoice_lines_invoice_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX renter_invoice_lines_invoice_idx ON public.renter_invoice_lines USING btree (organization_id, invoice_id, sort_order, id);


--
-- Name: renter_invoice_lines_org_type_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX renter_invoice_lines_org_type_idx ON public.renter_invoice_lines USING btree (organization_id, line_type, invoice_id);


--
-- Name: renter_invoice_public_links_invoice_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX renter_invoice_public_links_invoice_idx ON public.renter_invoice_public_links USING btree (organization_id, invoice_id, status, created_at DESC);


--
-- Name: renter_invoice_public_links_one_active_uidx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX renter_invoice_public_links_one_active_uidx ON public.renter_invoice_public_links USING btree (organization_id, invoice_id) WHERE (status = 'ACTIVE'::text);


--
-- Name: renter_invoice_reminders_invoice_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX renter_invoice_reminders_invoice_idx ON public.renter_invoice_reminders USING btree (organization_id, invoice_id, created_at DESC);


--
-- Name: renter_invoice_reminders_org_created_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX renter_invoice_reminders_org_created_idx ON public.renter_invoice_reminders USING btree (organization_id, created_at DESC);


--
-- Name: renter_invoice_reminders_tier_per_day_uidx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX renter_invoice_reminders_tier_per_day_uidx ON public.renter_invoice_reminders USING btree (organization_id, invoice_id, reminder_tier, reminder_date);


--
-- Name: renter_invoices_calculation_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX renter_invoices_calculation_status_idx ON public.renter_invoices USING btree (organization_id, billing_cycle_id, calculation_status, status, id);


--
-- Name: renter_invoices_collection_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX renter_invoices_collection_idx ON public.renter_invoices USING btree (organization_id, collection_status, due_date, id) WHERE (status = 'ISSUED'::text);


--
-- Name: renter_invoices_cycle_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX renter_invoices_cycle_idx ON public.renter_invoices USING btree (organization_id, billing_cycle_id, status, room_id, id);


--
-- Name: renter_invoices_cycle_room_code_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX renter_invoices_cycle_room_code_idx ON public.renter_invoices USING btree (organization_id, billing_cycle_id, room_code_snapshot, id);


--
-- Name: renter_invoices_lease_history_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX renter_invoices_lease_history_idx ON public.renter_invoices USING btree (organization_id, lease_id, period_start DESC, id);


--
-- Name: renter_invoices_org_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX renter_invoices_org_status_idx ON public.renter_invoices USING btree (organization_id, status, created_at DESC);


--
-- Name: renter_invoices_payment_reference_uidx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX renter_invoices_payment_reference_uidx ON public.renter_invoices USING btree (payment_reference);


--
-- Name: renter_invoices_room_history_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX renter_invoices_room_history_idx ON public.renter_invoices USING btree (organization_id, room_id, status, period_end DESC);


--
-- Name: renter_invoices_unpaid_cycle_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX renter_invoices_unpaid_cycle_idx ON public.renter_invoices USING btree (organization_id, billing_cycle_id) WHERE ((status = 'ISSUED'::text) AND (remaining_vnd > 0));


--
-- Name: renter_payment_allocations_invoice_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX renter_payment_allocations_invoice_idx ON public.renter_payment_allocations USING btree (organization_id, invoice_id, created_at, id);


--
-- Name: renter_payment_reconciliation_cursors_success_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX renter_payment_reconciliation_cursors_success_idx ON public.renter_payment_reconciliation_cursors USING btree (provider, last_success_at DESC NULLS LAST);


--
-- Name: renter_payment_transactions_provider_global_uidx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX renter_payment_transactions_provider_global_uidx ON public.renter_payment_transactions USING btree (provider, provider_transaction_id) WHERE ((source = 'PROVIDER'::text) AND (provider IS NOT NULL) AND (provider_transaction_id IS NOT NULL));


--
-- Name: renter_payment_transactions_provider_uidx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX renter_payment_transactions_provider_uidx ON public.renter_payment_transactions USING btree (organization_id, provider, provider_transaction_id) WHERE ((provider IS NOT NULL) AND (provider_transaction_id IS NOT NULL));


--
-- Name: renter_payment_transactions_reconciliation_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX renter_payment_transactions_reconciliation_idx ON public.renter_payment_transactions USING btree (reconciliation_status, occurred_at DESC, id) WHERE (source = 'PROVIDER'::text);


--
-- Name: renter_payment_transactions_time_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX renter_payment_transactions_time_idx ON public.renter_payment_transactions USING btree (organization_id, occurred_at DESC, id);


--
-- Name: renter_payment_webhook_events_processing_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX renter_payment_webhook_events_processing_idx ON public.renter_payment_webhook_events USING btree (processing_status, received_at, provider);


--
-- Name: renter_payment_webhook_events_provider_transaction_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX renter_payment_webhook_events_provider_transaction_idx ON public.renter_payment_webhook_events USING btree (provider, provider_transaction_id, received_at DESC) WHERE (provider_transaction_id IS NOT NULL);


--
-- Name: renter_provider_transaction_aliases_identity_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX renter_provider_transaction_aliases_identity_idx ON public.renter_provider_transaction_aliases USING btree (provider, identity_id, created_at);


--
-- Name: renter_provider_transaction_identities_reference_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX renter_provider_transaction_identities_reference_idx ON public.renter_provider_transaction_identities USING btree (provider, reference_number, occurred_at DESC);


--
-- Name: renter_refunds_org_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX renter_refunds_org_idx ON public.renter_refunds USING btree (organization_id, created_at DESC, id);


--
-- Name: residents_dashboard_active_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX residents_dashboard_active_idx ON public.residents USING btree (organization_id, id) WHERE (is_active = true);


--
-- Name: residents_org_name_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX residents_org_name_idx ON public.residents USING btree (organization_id, full_name, id);


--
-- Name: residents_org_phone_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX residents_org_phone_idx ON public.residents USING btree (organization_id, phone) WHERE (phone IS NOT NULL);


--
-- Name: room_equipment_org_room_name_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX room_equipment_org_room_name_idx ON public.room_equipment USING btree (organization_id, room_id, name);


--
-- Name: room_equipment_property_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX room_equipment_property_idx ON public.room_equipment USING btree (organization_id, property_id, name);


--
-- Name: room_equipment_room_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX room_equipment_room_idx ON public.room_equipment USING btree (organization_id, room_id, created_at DESC);


--
-- Name: room_reservations_org_property_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX room_reservations_org_property_idx ON public.room_reservations USING btree (organization_id, property_id, status);


--
-- Name: room_reservations_org_room_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX room_reservations_org_room_idx ON public.room_reservations USING btree (organization_id, room_id, status);


--
-- Name: room_reservations_until_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX room_reservations_until_idx ON public.room_reservations USING btree (organization_id, reserved_until, status);


--
-- Name: rooms_property_floor_order_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX rooms_property_floor_order_idx ON public.rooms USING btree (organization_id, property_id, floor_id, sort_order, id);


--
-- Name: saas_billing_webhook_events_processing_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX saas_billing_webhook_events_processing_idx ON public.saas_billing_webhook_events USING btree (processing_status, received_at, provider);


--
-- Name: saas_billing_webhook_events_provider_received_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX saas_billing_webhook_events_provider_received_idx ON public.saas_billing_webhook_events USING btree (provider, received_at DESC);


--
-- Name: saas_subscription_invoices_due_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX saas_subscription_invoices_due_idx ON public.saas_subscription_invoices USING btree (due_at, organization_id) WHERE (status = ANY (ARRAY['OPEN'::text, 'PARTIALLY_PAID'::text]));


--
-- Name: saas_subscription_invoices_org_period_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX saas_subscription_invoices_org_period_idx ON public.saas_subscription_invoices USING btree (organization_id, period_start DESC, period_end DESC);


--
-- Name: saas_subscription_invoices_payment_reference_uidx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX saas_subscription_invoices_payment_reference_uidx ON public.saas_subscription_invoices USING btree (payment_reference);


--
-- Name: saas_subscription_payment_allocations_invoice_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX saas_subscription_payment_allocations_invoice_idx ON public.saas_subscription_payment_allocations USING btree (organization_id, invoice_id, created_at);


--
-- Name: saas_subscription_payment_allocations_payment_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX saas_subscription_payment_allocations_payment_idx ON public.saas_subscription_payment_allocations USING btree (organization_id, payment_id, created_at);


--
-- Name: saas_subscription_payments_org_time_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX saas_subscription_payments_org_time_idx ON public.saas_subscription_payments USING btree (organization_id, occurred_at DESC);


--
-- Name: saas_subscription_payments_provider_tx_uidx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX saas_subscription_payments_provider_tx_uidx ON public.saas_subscription_payments USING btree (provider, provider_transaction_id) WHERE ((provider IS NOT NULL) AND (provider_transaction_id IS NOT NULL));


--
-- Name: system_settings_group_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX system_settings_group_idx ON public.system_settings USING btree (group_key, key);


--
-- Name: system_worker_heartbeats_role_seen_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX system_worker_heartbeats_role_seen_idx ON public.system_worker_heartbeats USING btree (role, last_seen_at DESC);


--
-- Name: system_worker_heartbeats_status_seen_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX system_worker_heartbeats_status_seen_idx ON public.system_worker_heartbeats USING btree (status, last_seen_at DESC);


--
-- Name: user_auth_identities_user_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX user_auth_identities_user_idx ON public.user_auth_identities USING btree (user_id);


--
-- Name: user_mfa_recovery_codes_active_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX user_mfa_recovery_codes_active_idx ON public.user_mfa_recovery_codes USING btree (user_id, created_at) WHERE (used_at IS NULL);


--
-- Name: user_passkeys_user_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX user_passkeys_user_idx ON public.user_passkeys USING btree (user_id, created_at DESC);


--
-- Name: users_email_ci_uidx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX users_email_ci_uidx ON public.users USING btree (lower(email));


--
-- Name: users_organization_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX users_organization_status_idx ON public.users USING btree (organization_id, status) WHERE (account_type = 'TENANT'::text);


--
-- Name: organization_memberships organization_memberships_enforce_user_tenant; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER organization_memberships_enforce_user_tenant BEFORE INSERT OR UPDATE OF organization_id, user_id ON public.organization_memberships FOR EACH ROW EXECUTE FUNCTION public.enforce_tenant_membership_user_scope();


--
-- Name: administrative_areas administrative_areas_parent_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.administrative_areas
    ADD CONSTRAINT administrative_areas_parent_id_fkey FOREIGN KEY (parent_id) REFERENCES public.administrative_areas(id) ON DELETE RESTRICT;


--
-- Name: audit_events audit_events_actor_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.audit_events
    ADD CONSTRAINT audit_events_actor_user_id_fkey FOREIGN KEY (actor_user_id) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: audit_events audit_events_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.audit_events
    ADD CONSTRAINT audit_events_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE RESTRICT;


--
-- Name: auth_mfa_challenges auth_mfa_challenges_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.auth_mfa_challenges
    ADD CONSTRAINT auth_mfa_challenges_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: auth_password_reset_tokens auth_password_reset_tokens_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.auth_password_reset_tokens
    ADD CONSTRAINT auth_password_reset_tokens_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: auth_security_alerts auth_security_alerts_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.auth_security_alerts
    ADD CONSTRAINT auth_security_alerts_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE SET NULL;


--
-- Name: auth_security_alerts auth_security_alerts_source_event_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.auth_security_alerts
    ADD CONSTRAINT auth_security_alerts_source_event_id_fkey FOREIGN KEY (source_event_id) REFERENCES public.auth_security_events(id) ON DELETE SET NULL;


--
-- Name: auth_security_alerts auth_security_alerts_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.auth_security_alerts
    ADD CONSTRAINT auth_security_alerts_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: auth_security_events auth_security_events_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.auth_security_events
    ADD CONSTRAINT auth_security_events_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE SET NULL;


--
-- Name: auth_security_events auth_security_events_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.auth_security_events
    ADD CONSTRAINT auth_security_events_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: auth_sessions auth_sessions_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.auth_sessions
    ADD CONSTRAINT auth_sessions_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE;


--
-- Name: auth_sessions auth_sessions_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.auth_sessions
    ADD CONSTRAINT auth_sessions_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: auth_webauthn_challenges auth_webauthn_challenges_session_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.auth_webauthn_challenges
    ADD CONSTRAINT auth_webauthn_challenges_session_id_fkey FOREIGN KEY (session_id) REFERENCES public.auth_sessions(id) ON DELETE CASCADE;


--
-- Name: auth_webauthn_challenges auth_webauthn_challenges_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.auth_webauthn_challenges
    ADD CONSTRAINT auth_webauthn_challenges_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: automation_quota_consumptions automation_quota_consumptions_organization_id_reservation__fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.automation_quota_consumptions
    ADD CONSTRAINT automation_quota_consumptions_organization_id_reservation__fkey FOREIGN KEY (organization_id, reservation_id) REFERENCES public.automation_quota_reservations(organization_id, id) ON DELETE CASCADE;


--
-- Name: automation_quota_periods automation_quota_periods_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.automation_quota_periods
    ADD CONSTRAINT automation_quota_periods_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE;


--
-- Name: automation_quota_reservations automation_quota_reservations_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.automation_quota_reservations
    ADD CONSTRAINT automation_quota_reservations_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE;


--
-- Name: automation_quota_reservations automation_quota_reservations_organization_id_period_start_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.automation_quota_reservations
    ADD CONSTRAINT automation_quota_reservations_organization_id_period_start_fkey FOREIGN KEY (organization_id, period_start) REFERENCES public.automation_quota_periods(organization_id, period_start) ON DELETE RESTRICT;


--
-- Name: floors floors_organization_id_property_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.floors
    ADD CONSTRAINT floors_organization_id_property_id_fkey FOREIGN KEY (organization_id, property_id) REFERENCES public.properties(organization_id, id) ON DELETE CASCADE;


--
-- Name: lease_amendments lease_amendments_actor_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.lease_amendments
    ADD CONSTRAINT lease_amendments_actor_user_id_fkey FOREIGN KEY (actor_user_id) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: lease_amendments lease_amendments_lease_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.lease_amendments
    ADD CONSTRAINT lease_amendments_lease_id_fkey FOREIGN KEY (lease_id) REFERENCES public.leases(id) ON DELETE CASCADE;


--
-- Name: lease_amendments lease_amendments_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.lease_amendments
    ADD CONSTRAINT lease_amendments_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE;


--
-- Name: lease_attachments lease_attachments_actor_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.lease_attachments
    ADD CONSTRAINT lease_attachments_actor_user_id_fkey FOREIGN KEY (actor_user_id) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: lease_attachments lease_attachments_lease_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.lease_attachments
    ADD CONSTRAINT lease_attachments_lease_id_fkey FOREIGN KEY (lease_id) REFERENCES public.leases(id) ON DELETE CASCADE;


--
-- Name: lease_attachments lease_attachments_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.lease_attachments
    ADD CONSTRAINT lease_attachments_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE;


--
-- Name: lease_command_receipts lease_command_receipts_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.lease_command_receipts
    ADD CONSTRAINT lease_command_receipts_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE;


--
-- Name: lease_command_receipts lease_command_receipts_organization_id_lease_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.lease_command_receipts
    ADD CONSTRAINT lease_command_receipts_organization_id_lease_id_fkey FOREIGN KEY (organization_id, lease_id) REFERENCES public.leases(organization_id, id) ON DELETE CASCADE;


--
-- Name: lease_deposit_entries lease_deposit_entries_created_by_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.lease_deposit_entries
    ADD CONSTRAINT lease_deposit_entries_created_by_user_id_fkey FOREIGN KEY (created_by_user_id) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: lease_deposit_entries lease_deposit_entries_organization_id_lease_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.lease_deposit_entries
    ADD CONSTRAINT lease_deposit_entries_organization_id_lease_id_fkey FOREIGN KEY (organization_id, lease_id) REFERENCES public.leases(organization_id, id) ON DELETE RESTRICT;


--
-- Name: lease_residents lease_residents_organization_id_lease_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.lease_residents
    ADD CONSTRAINT lease_residents_organization_id_lease_id_fkey FOREIGN KEY (organization_id, lease_id) REFERENCES public.leases(organization_id, id) ON DELETE CASCADE;


--
-- Name: lease_residents lease_residents_organization_id_resident_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.lease_residents
    ADD CONSTRAINT lease_residents_organization_id_resident_id_fkey FOREIGN KEY (organization_id, resident_id) REFERENCES public.residents(organization_id, id) ON DELETE RESTRICT;


--
-- Name: lease_terminations lease_terminations_cancelled_by_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.lease_terminations
    ADD CONSTRAINT lease_terminations_cancelled_by_user_id_fkey FOREIGN KEY (cancelled_by_user_id) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: lease_terminations lease_terminations_completed_by_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.lease_terminations
    ADD CONSTRAINT lease_terminations_completed_by_user_id_fkey FOREIGN KEY (completed_by_user_id) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: lease_terminations lease_terminations_initiated_by_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.lease_terminations
    ADD CONSTRAINT lease_terminations_initiated_by_user_id_fkey FOREIGN KEY (initiated_by_user_id) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: lease_terminations lease_terminations_organization_id_lease_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.lease_terminations
    ADD CONSTRAINT lease_terminations_organization_id_lease_id_fkey FOREIGN KEY (organization_id, lease_id) REFERENCES public.leases(organization_id, id) ON DELETE RESTRICT;


--
-- Name: lease_vehicles lease_vehicles_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.lease_vehicles
    ADD CONSTRAINT lease_vehicles_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE;


--
-- Name: lease_vehicles lease_vehicles_organization_id_lease_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.lease_vehicles
    ADD CONSTRAINT lease_vehicles_organization_id_lease_id_fkey FOREIGN KEY (organization_id, lease_id) REFERENCES public.leases(organization_id, id) ON DELETE CASCADE;


--
-- Name: leases leases_created_by_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.leases
    ADD CONSTRAINT leases_created_by_user_id_fkey FOREIGN KEY (created_by_user_id) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: leases leases_organization_id_room_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.leases
    ADD CONSTRAINT leases_organization_id_room_id_fkey FOREIGN KEY (organization_id, room_id) REFERENCES public.rooms(organization_id, id) ON DELETE RESTRICT;


--
-- Name: leases leases_renewed_from_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.leases
    ADD CONSTRAINT leases_renewed_from_fk FOREIGN KEY (organization_id, renewed_from_lease_id) REFERENCES public.leases(organization_id, id) ON DELETE SET NULL;


--
-- Name: leases leases_updated_by_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.leases
    ADD CONSTRAINT leases_updated_by_user_id_fkey FOREIGN KEY (updated_by_user_id) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: maintenance_tickets maintenance_tickets_created_by_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.maintenance_tickets
    ADD CONSTRAINT maintenance_tickets_created_by_user_id_fkey FOREIGN KEY (created_by_user_id) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: maintenance_tickets maintenance_tickets_linked_expense_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.maintenance_tickets
    ADD CONSTRAINT maintenance_tickets_linked_expense_id_fkey FOREIGN KEY (linked_expense_id) REFERENCES public.operating_expenses(id) ON DELETE SET NULL;


--
-- Name: maintenance_tickets maintenance_tickets_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.maintenance_tickets
    ADD CONSTRAINT maintenance_tickets_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE;


--
-- Name: maintenance_tickets maintenance_tickets_organization_id_lease_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.maintenance_tickets
    ADD CONSTRAINT maintenance_tickets_organization_id_lease_id_fkey FOREIGN KEY (organization_id, lease_id) REFERENCES public.leases(organization_id, id) ON DELETE SET NULL;


--
-- Name: maintenance_tickets maintenance_tickets_organization_id_property_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.maintenance_tickets
    ADD CONSTRAINT maintenance_tickets_organization_id_property_id_fkey FOREIGN KEY (organization_id, property_id) REFERENCES public.properties(organization_id, id) ON DELETE CASCADE;


--
-- Name: maintenance_tickets maintenance_tickets_organization_id_room_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.maintenance_tickets
    ADD CONSTRAINT maintenance_tickets_organization_id_room_id_fkey FOREIGN KEY (organization_id, room_id) REFERENCES public.rooms(organization_id, id) ON DELETE SET NULL;


--
-- Name: membership_scopes membership_scopes_organization_id_membership_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.membership_scopes
    ADD CONSTRAINT membership_scopes_organization_id_membership_id_fkey FOREIGN KEY (organization_id, membership_id) REFERENCES public.organization_memberships(organization_id, id) ON DELETE CASCADE;


--
-- Name: membership_scopes membership_scopes_organization_id_operational_group_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.membership_scopes
    ADD CONSTRAINT membership_scopes_organization_id_operational_group_id_fkey FOREIGN KEY (organization_id, operational_group_id) REFERENCES public.operational_groups(organization_id, id) ON DELETE CASCADE;


--
-- Name: membership_scopes membership_scopes_organization_id_property_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.membership_scopes
    ADD CONSTRAINT membership_scopes_organization_id_property_id_fkey FOREIGN KEY (organization_id, property_id) REFERENCES public.properties(organization_id, id) ON DELETE CASCADE;


--
-- Name: meter_readings meter_readings_created_by_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.meter_readings
    ADD CONSTRAINT meter_readings_created_by_user_id_fkey FOREIGN KEY (created_by_user_id) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: meter_readings meter_readings_organization_id_meter_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.meter_readings
    ADD CONSTRAINT meter_readings_organization_id_meter_id_fkey FOREIGN KEY (organization_id, meter_id) REFERENCES public.meters(organization_id, id) ON DELETE RESTRICT;


--
-- Name: meters meters_created_by_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.meters
    ADD CONSTRAINT meters_created_by_user_id_fkey FOREIGN KEY (created_by_user_id) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: meters meters_organization_id_room_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.meters
    ADD CONSTRAINT meters_organization_id_room_id_fkey FOREIGN KEY (organization_id, room_id) REFERENCES public.rooms(organization_id, id) ON DELETE RESTRICT;


--
-- Name: notification_attempts notification_attempts_organization_id_job_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notification_attempts
    ADD CONSTRAINT notification_attempts_organization_id_job_id_fkey FOREIGN KEY (organization_id, job_id) REFERENCES public.notification_jobs(organization_id, id) ON DELETE CASCADE;


--
-- Name: notification_campaigns notification_campaigns_created_by_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notification_campaigns
    ADD CONSTRAINT notification_campaigns_created_by_user_id_fkey FOREIGN KEY (created_by_user_id) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: notification_campaigns notification_campaigns_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notification_campaigns
    ADD CONSTRAINT notification_campaigns_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE;


--
-- Name: notification_campaigns notification_campaigns_organization_id_quota_reservation_i_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notification_campaigns
    ADD CONSTRAINT notification_campaigns_organization_id_quota_reservation_i_fkey FOREIGN KEY (organization_id, quota_reservation_id) REFERENCES public.automation_quota_reservations(organization_id, id) ON DELETE RESTRICT;


--
-- Name: notification_jobs notification_jobs_organization_id_campaign_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notification_jobs
    ADD CONSTRAINT notification_jobs_organization_id_campaign_id_fkey FOREIGN KEY (organization_id, campaign_id) REFERENCES public.notification_campaigns(organization_id, id) ON DELETE CASCADE;


--
-- Name: notification_provider_controls notification_provider_controls_updated_by_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notification_provider_controls
    ADD CONSTRAINT notification_provider_controls_updated_by_user_id_fkey FOREIGN KEY (updated_by_user_id) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: operating_expenses operating_expenses_created_by_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.operating_expenses
    ADD CONSTRAINT operating_expenses_created_by_user_id_fkey FOREIGN KEY (created_by_user_id) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: operating_expenses operating_expenses_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.operating_expenses
    ADD CONSTRAINT operating_expenses_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE;


--
-- Name: operating_expenses operating_expenses_organization_id_property_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.operating_expenses
    ADD CONSTRAINT operating_expenses_organization_id_property_id_fkey FOREIGN KEY (organization_id, property_id) REFERENCES public.properties(organization_id, id) ON DELETE SET NULL;


--
-- Name: operational_groups operational_groups_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.operational_groups
    ADD CONSTRAINT operational_groups_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE;


--
-- Name: organization_entitlement_overrides organization_entitlement_overrides_created_by_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.organization_entitlement_overrides
    ADD CONSTRAINT organization_entitlement_overrides_created_by_user_id_fkey FOREIGN KEY (created_by_user_id) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: organization_entitlement_overrides organization_entitlement_overrides_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.organization_entitlement_overrides
    ADD CONSTRAINT organization_entitlement_overrides_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE;


--
-- Name: organization_entitlement_overrides organization_entitlement_overrides_revoked_by_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.organization_entitlement_overrides
    ADD CONSTRAINT organization_entitlement_overrides_revoked_by_user_id_fkey FOREIGN KEY (revoked_by_user_id) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: organization_memberships organization_memberships_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.organization_memberships
    ADD CONSTRAINT organization_memberships_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE;


--
-- Name: organization_memberships organization_memberships_tenant_user_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.organization_memberships
    ADD CONSTRAINT organization_memberships_tenant_user_fk FOREIGN KEY (organization_id, user_id) REFERENCES public.users(organization_id, id) ON DELETE CASCADE;


--
-- Name: organization_memberships organization_memberships_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.organization_memberships
    ADD CONSTRAINT organization_memberships_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: organization_payment_profiles organization_payment_profiles_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.organization_payment_profiles
    ADD CONSTRAINT organization_payment_profiles_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE;


--
-- Name: organization_payment_profiles organization_payment_profiles_updated_by_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.organization_payment_profiles
    ADD CONSTRAINT organization_payment_profiles_updated_by_user_id_fkey FOREIGN KEY (updated_by_user_id) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: organization_subscriptions organization_subscriptions_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.organization_subscriptions
    ADD CONSTRAINT organization_subscriptions_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE RESTRICT;


--
-- Name: organization_subscriptions organization_subscriptions_plan_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.organization_subscriptions
    ADD CONSTRAINT organization_subscriptions_plan_id_fkey FOREIGN KEY (plan_id) REFERENCES public.saas_plans(id) ON DELETE RESTRICT;


--
-- Name: organization_subscriptions organization_subscriptions_plan_id_plan_version_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.organization_subscriptions
    ADD CONSTRAINT organization_subscriptions_plan_id_plan_version_id_fkey FOREIGN KEY (plan_id, plan_version_id) REFERENCES public.saas_plan_versions(plan_id, id) ON DELETE RESTRICT;


--
-- Name: platform_audit_events platform_audit_events_actor_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.platform_audit_events
    ADD CONSTRAINT platform_audit_events_actor_user_id_fkey FOREIGN KEY (actor_user_id) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: platform_audit_events platform_audit_events_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.platform_audit_events
    ADD CONSTRAINT platform_audit_events_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE RESTRICT;


--
-- Name: platform_command_receipts platform_command_receipts_actor_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.platform_command_receipts
    ADD CONSTRAINT platform_command_receipts_actor_user_id_fkey FOREIGN KEY (actor_user_id) REFERENCES public.users(id) ON DELETE RESTRICT;


--
-- Name: platform_operators platform_operators_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.platform_operators
    ADD CONSTRAINT platform_operators_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: pricing_policies pricing_policies_created_by_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pricing_policies
    ADD CONSTRAINT pricing_policies_created_by_user_id_fkey FOREIGN KEY (created_by_user_id) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: pricing_policies pricing_policies_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pricing_policies
    ADD CONSTRAINT pricing_policies_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE;


--
-- Name: pricing_policies pricing_policies_organization_id_property_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pricing_policies
    ADD CONSTRAINT pricing_policies_organization_id_property_id_fkey FOREIGN KEY (organization_id, property_id) REFERENCES public.properties(organization_id, id) ON DELETE RESTRICT;


--
-- Name: pricing_policy_items pricing_policy_items_organization_id_policy_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pricing_policy_items
    ADD CONSTRAINT pricing_policy_items_organization_id_policy_id_fkey FOREIGN KEY (organization_id, policy_id) REFERENCES public.pricing_policies(organization_id, id) ON DELETE CASCADE;


--
-- Name: properties properties_administrative_area_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.properties
    ADD CONSTRAINT properties_administrative_area_id_fkey FOREIGN KEY (administrative_area_id) REFERENCES public.administrative_areas(id) ON DELETE RESTRICT;


--
-- Name: properties properties_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.properties
    ADD CONSTRAINT properties_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE;


--
-- Name: property_operational_groups property_operational_groups_organization_id_operational_gr_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.property_operational_groups
    ADD CONSTRAINT property_operational_groups_organization_id_operational_gr_fkey FOREIGN KEY (organization_id, operational_group_id) REFERENCES public.operational_groups(organization_id, id) ON DELETE CASCADE;


--
-- Name: property_operational_groups property_operational_groups_organization_id_property_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.property_operational_groups
    ADD CONSTRAINT property_operational_groups_organization_id_property_id_fkey FOREIGN KEY (organization_id, property_id) REFERENCES public.properties(organization_id, id) ON DELETE CASCADE;


--
-- Name: renter_billing_cycles renter_billing_cycles_created_by_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.renter_billing_cycles
    ADD CONSTRAINT renter_billing_cycles_created_by_user_id_fkey FOREIGN KEY (created_by_user_id) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: renter_billing_cycles renter_billing_cycles_finalized_by_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.renter_billing_cycles
    ADD CONSTRAINT renter_billing_cycles_finalized_by_user_id_fkey FOREIGN KEY (finalized_by_user_id) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: renter_billing_cycles renter_billing_cycles_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.renter_billing_cycles
    ADD CONSTRAINT renter_billing_cycles_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE;


--
-- Name: renter_billing_cycles renter_billing_cycles_organization_id_property_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.renter_billing_cycles
    ADD CONSTRAINT renter_billing_cycles_organization_id_property_id_fkey FOREIGN KEY (organization_id, property_id) REFERENCES public.properties(organization_id, id) ON DELETE RESTRICT;


--
-- Name: renter_credit_balances renter_credit_balances_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.renter_credit_balances
    ADD CONSTRAINT renter_credit_balances_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE RESTRICT;


--
-- Name: renter_credit_movements renter_credit_movements_created_by_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.renter_credit_movements
    ADD CONSTRAINT renter_credit_movements_created_by_user_id_fkey FOREIGN KEY (created_by_user_id) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: renter_credit_movements renter_credit_movements_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.renter_credit_movements
    ADD CONSTRAINT renter_credit_movements_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE RESTRICT;


--
-- Name: renter_invoice_adjustments renter_invoice_adjustments_created_by_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.renter_invoice_adjustments
    ADD CONSTRAINT renter_invoice_adjustments_created_by_user_id_fkey FOREIGN KEY (created_by_user_id) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: renter_invoice_adjustments renter_invoice_adjustments_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.renter_invoice_adjustments
    ADD CONSTRAINT renter_invoice_adjustments_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE;


--
-- Name: renter_invoice_adjustments renter_invoice_adjustments_organization_id_invoice_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.renter_invoice_adjustments
    ADD CONSTRAINT renter_invoice_adjustments_organization_id_invoice_id_fkey FOREIGN KEY (organization_id, invoice_id) REFERENCES public.renter_invoices(organization_id, id) ON DELETE CASCADE;


--
-- Name: renter_invoice_lines renter_invoice_lines_organization_id_invoice_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.renter_invoice_lines
    ADD CONSTRAINT renter_invoice_lines_organization_id_invoice_id_fkey FOREIGN KEY (organization_id, invoice_id) REFERENCES public.renter_invoices(organization_id, id) ON DELETE CASCADE;


--
-- Name: renter_invoice_public_links renter_invoice_public_links_created_by_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.renter_invoice_public_links
    ADD CONSTRAINT renter_invoice_public_links_created_by_user_id_fkey FOREIGN KEY (created_by_user_id) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: renter_invoice_public_links renter_invoice_public_links_organization_id_invoice_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.renter_invoice_public_links
    ADD CONSTRAINT renter_invoice_public_links_organization_id_invoice_id_fkey FOREIGN KEY (organization_id, invoice_id) REFERENCES public.renter_invoices(organization_id, id) ON DELETE CASCADE;


--
-- Name: renter_invoice_public_links renter_invoice_public_links_revoked_by_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.renter_invoice_public_links
    ADD CONSTRAINT renter_invoice_public_links_revoked_by_user_id_fkey FOREIGN KEY (revoked_by_user_id) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: renter_invoice_reminders renter_invoice_reminders_notification_job_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.renter_invoice_reminders
    ADD CONSTRAINT renter_invoice_reminders_notification_job_id_fkey FOREIGN KEY (notification_job_id) REFERENCES public.notification_jobs(id) ON DELETE SET NULL;


--
-- Name: renter_invoice_reminders renter_invoice_reminders_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.renter_invoice_reminders
    ADD CONSTRAINT renter_invoice_reminders_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE;


--
-- Name: renter_invoice_reminders renter_invoice_reminders_organization_id_invoice_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.renter_invoice_reminders
    ADD CONSTRAINT renter_invoice_reminders_organization_id_invoice_id_fkey FOREIGN KEY (organization_id, invoice_id) REFERENCES public.renter_invoices(organization_id, id) ON DELETE CASCADE;


--
-- Name: renter_invoices renter_invoices_organization_id_lease_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.renter_invoices
    ADD CONSTRAINT renter_invoices_organization_id_lease_id_fkey FOREIGN KEY (organization_id, lease_id) REFERENCES public.leases(organization_id, id) ON DELETE RESTRICT;


--
-- Name: renter_invoices renter_invoices_organization_id_property_id_billing_cycle__fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.renter_invoices
    ADD CONSTRAINT renter_invoices_organization_id_property_id_billing_cycle__fkey FOREIGN KEY (organization_id, property_id, billing_cycle_id) REFERENCES public.renter_billing_cycles(organization_id, property_id, id) ON DELETE RESTRICT;


--
-- Name: renter_invoices renter_invoices_organization_id_property_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.renter_invoices
    ADD CONSTRAINT renter_invoices_organization_id_property_id_fkey FOREIGN KEY (organization_id, property_id) REFERENCES public.properties(organization_id, id) ON DELETE RESTRICT;


--
-- Name: renter_invoices renter_invoices_organization_id_room_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.renter_invoices
    ADD CONSTRAINT renter_invoices_organization_id_room_id_fkey FOREIGN KEY (organization_id, room_id) REFERENCES public.rooms(organization_id, id) ON DELETE RESTRICT;


--
-- Name: renter_payment_allocations renter_payment_allocations_created_by_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.renter_payment_allocations
    ADD CONSTRAINT renter_payment_allocations_created_by_user_id_fkey FOREIGN KEY (created_by_user_id) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: renter_payment_allocations renter_payment_allocations_organization_id_invoice_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.renter_payment_allocations
    ADD CONSTRAINT renter_payment_allocations_organization_id_invoice_id_fkey FOREIGN KEY (organization_id, invoice_id) REFERENCES public.renter_invoices(organization_id, id) ON DELETE RESTRICT;


--
-- Name: renter_payment_allocations renter_payment_allocations_organization_id_payment_transac_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.renter_payment_allocations
    ADD CONSTRAINT renter_payment_allocations_organization_id_payment_transac_fkey FOREIGN KEY (organization_id, payment_transaction_id) REFERENCES public.renter_payment_transactions(organization_id, id) ON DELETE RESTRICT;


--
-- Name: renter_payment_transactions renter_payment_transactions_created_by_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.renter_payment_transactions
    ADD CONSTRAINT renter_payment_transactions_created_by_user_id_fkey FOREIGN KEY (created_by_user_id) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: renter_payment_transactions renter_payment_transactions_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.renter_payment_transactions
    ADD CONSTRAINT renter_payment_transactions_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE RESTRICT;


--
-- Name: renter_payment_webhook_events renter_payment_webhook_events_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.renter_payment_webhook_events
    ADD CONSTRAINT renter_payment_webhook_events_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE RESTRICT;


--
-- Name: renter_payment_webhook_events renter_payment_webhook_events_payment_transaction_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.renter_payment_webhook_events
    ADD CONSTRAINT renter_payment_webhook_events_payment_transaction_id_fkey FOREIGN KEY (payment_transaction_id) REFERENCES public.renter_payment_transactions(id) ON DELETE RESTRICT;


--
-- Name: renter_provider_transaction_aliases renter_provider_transaction_aliases_provider_identity_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.renter_provider_transaction_aliases
    ADD CONSTRAINT renter_provider_transaction_aliases_provider_identity_id_fkey FOREIGN KEY (provider, identity_id) REFERENCES public.renter_provider_transaction_identities(provider, id) ON DELETE CASCADE;


--
-- Name: renter_provider_transaction_identities renter_provider_transaction_identit_payment_transaction_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.renter_provider_transaction_identities
    ADD CONSTRAINT renter_provider_transaction_identit_payment_transaction_id_fkey FOREIGN KEY (payment_transaction_id) REFERENCES public.renter_payment_transactions(id) ON DELETE RESTRICT;


--
-- Name: renter_refunds renter_refunds_created_by_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.renter_refunds
    ADD CONSTRAINT renter_refunds_created_by_user_id_fkey FOREIGN KEY (created_by_user_id) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: renter_refunds renter_refunds_credit_movement_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.renter_refunds
    ADD CONSTRAINT renter_refunds_credit_movement_id_fkey FOREIGN KEY (credit_movement_id) REFERENCES public.renter_credit_movements(id) ON DELETE RESTRICT;


--
-- Name: renter_refunds renter_refunds_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.renter_refunds
    ADD CONSTRAINT renter_refunds_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE RESTRICT;


--
-- Name: residents residents_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.residents
    ADD CONSTRAINT residents_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE;


--
-- Name: room_equipment room_equipment_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.room_equipment
    ADD CONSTRAINT room_equipment_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE;


--
-- Name: room_equipment room_equipment_organization_id_property_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.room_equipment
    ADD CONSTRAINT room_equipment_organization_id_property_id_fkey FOREIGN KEY (organization_id, property_id) REFERENCES public.properties(organization_id, id) ON DELETE CASCADE;


--
-- Name: room_equipment room_equipment_organization_id_room_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.room_equipment
    ADD CONSTRAINT room_equipment_organization_id_room_id_fkey FOREIGN KEY (organization_id, room_id) REFERENCES public.rooms(organization_id, id) ON DELETE CASCADE;


--
-- Name: room_reservations room_reservations_created_by_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.room_reservations
    ADD CONSTRAINT room_reservations_created_by_user_id_fkey FOREIGN KEY (created_by_user_id) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: room_reservations room_reservations_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.room_reservations
    ADD CONSTRAINT room_reservations_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE;


--
-- Name: room_reservations room_reservations_organization_id_property_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.room_reservations
    ADD CONSTRAINT room_reservations_organization_id_property_id_fkey FOREIGN KEY (organization_id, property_id) REFERENCES public.properties(organization_id, id) ON DELETE CASCADE;


--
-- Name: room_reservations room_reservations_organization_id_room_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.room_reservations
    ADD CONSTRAINT room_reservations_organization_id_room_id_fkey FOREIGN KEY (organization_id, room_id) REFERENCES public.rooms(organization_id, id) ON DELETE CASCADE;


--
-- Name: rooms rooms_organization_id_property_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.rooms
    ADD CONSTRAINT rooms_organization_id_property_id_fkey FOREIGN KEY (organization_id, property_id) REFERENCES public.properties(organization_id, id) ON DELETE CASCADE;


--
-- Name: rooms rooms_organization_id_property_id_floor_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.rooms
    ADD CONSTRAINT rooms_organization_id_property_id_floor_id_fkey FOREIGN KEY (organization_id, property_id, floor_id) REFERENCES public.floors(organization_id, property_id, id) ON DELETE RESTRICT;


--
-- Name: saas_billing_webhook_events saas_billing_webhook_events_payment_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.saas_billing_webhook_events
    ADD CONSTRAINT saas_billing_webhook_events_payment_id_fkey FOREIGN KEY (payment_id) REFERENCES public.saas_subscription_payments(id) ON DELETE RESTRICT;


--
-- Name: saas_plan_versions saas_plan_versions_created_by_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.saas_plan_versions
    ADD CONSTRAINT saas_plan_versions_created_by_user_id_fkey FOREIGN KEY (created_by_user_id) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: saas_plan_versions saas_plan_versions_plan_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.saas_plan_versions
    ADD CONSTRAINT saas_plan_versions_plan_id_fkey FOREIGN KEY (plan_id) REFERENCES public.saas_plans(id) ON DELETE RESTRICT;


--
-- Name: saas_plans saas_plans_current_version_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.saas_plans
    ADD CONSTRAINT saas_plans_current_version_fk FOREIGN KEY (id, current_version_id) REFERENCES public.saas_plan_versions(plan_id, id) ON DELETE RESTRICT;


--
-- Name: saas_subscription_invoices saas_subscription_invoices_organization_id_subscription_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.saas_subscription_invoices
    ADD CONSTRAINT saas_subscription_invoices_organization_id_subscription_id_fkey FOREIGN KEY (organization_id, subscription_id) REFERENCES public.organization_subscriptions(organization_id, id) ON DELETE RESTRICT;


--
-- Name: saas_subscription_invoices saas_subscription_invoices_plan_id_plan_version_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.saas_subscription_invoices
    ADD CONSTRAINT saas_subscription_invoices_plan_id_plan_version_id_fkey FOREIGN KEY (plan_id, plan_version_id) REFERENCES public.saas_plan_versions(plan_id, id) ON DELETE RESTRICT;


--
-- Name: saas_subscription_payment_allocations saas_subscription_payment_alloc_organization_id_invoice_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.saas_subscription_payment_allocations
    ADD CONSTRAINT saas_subscription_payment_alloc_organization_id_invoice_id_fkey FOREIGN KEY (organization_id, invoice_id) REFERENCES public.saas_subscription_invoices(organization_id, id) ON DELETE RESTRICT;


--
-- Name: saas_subscription_payment_allocations saas_subscription_payment_alloc_organization_id_payment_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.saas_subscription_payment_allocations
    ADD CONSTRAINT saas_subscription_payment_alloc_organization_id_payment_id_fkey FOREIGN KEY (organization_id, payment_id) REFERENCES public.saas_subscription_payments(organization_id, id) ON DELETE RESTRICT;


--
-- Name: saas_subscription_payment_allocations saas_subscription_payment_allocations_allocated_by_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.saas_subscription_payment_allocations
    ADD CONSTRAINT saas_subscription_payment_allocations_allocated_by_user_id_fkey FOREIGN KEY (allocated_by_user_id) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: saas_subscription_payments saas_subscription_payments_organization_id_subscription_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.saas_subscription_payments
    ADD CONSTRAINT saas_subscription_payments_organization_id_subscription_id_fkey FOREIGN KEY (organization_id, subscription_id) REFERENCES public.organization_subscriptions(organization_id, id) ON DELETE RESTRICT;


--
-- Name: saas_subscription_payments saas_subscription_payments_recorded_by_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.saas_subscription_payments
    ADD CONSTRAINT saas_subscription_payments_recorded_by_user_id_fkey FOREIGN KEY (recorded_by_user_id) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: system_settings system_settings_updated_by_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.system_settings
    ADD CONSTRAINT system_settings_updated_by_user_id_fkey FOREIGN KEY (updated_by_user_id) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: user_auth_identities user_auth_identities_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_auth_identities
    ADD CONSTRAINT user_auth_identities_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: user_mfa_recovery_codes user_mfa_recovery_codes_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_mfa_recovery_codes
    ADD CONSTRAINT user_mfa_recovery_codes_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: user_passkeys user_passkeys_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_passkeys
    ADD CONSTRAINT user_passkeys_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: user_password_credentials user_password_credentials_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_password_credentials
    ADD CONSTRAINT user_password_credentials_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: user_totp_credentials user_totp_credentials_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_totp_credentials
    ADD CONSTRAINT user_totp_credentials_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: users users_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE RESTRICT;


--
-- PostgreSQL database dump complete
--



--
-- Seed default system settings
--

SET search_path = public, pg_catalog;

INSERT INTO system_settings (key, group_key, label, description, value, value_type)
VALUES
  ('registration_enabled', 'General', 'Cho phép đăng ký mới', 'Bật/tắt signup SaaS.', 'true'::jsonb, 'BOOLEAN'),
  ('maintenance_mode', 'General', 'Maintenance mode', 'Chuyển tenant surfaces sang maintenance policy.', 'false'::jsonb, 'BOOLEAN'),
  ('trial_days', 'Billing', 'Số ngày dùng thử', 'Thời lượng trial mặc định.', '30'::jsonb, 'INTEGER'),
  ('grace_period_days', 'Billing', 'Grace period', 'Số ngày trước khi subscription chuyển read-only.', '7'::jsonb, 'INTEGER'),
  ('notification_retry_limit', 'Automation', 'Notification retry limit', 'Giới hạn retry tự động.', '3'::jsonb, 'INTEGER'),
  ('playwright_provider_enabled', 'Automation', 'Playwright provider', 'Edge provider chuyển tiếp cho Zalo.', 'true'::jsonb, 'BOOLEAN'),
  ('automation_quota_timezone', 'Automation', 'Automation quota timezone', 'Calendar-month timezone used for automation quota periods.', '"Asia/Ho_Chi_Minh"'::jsonb, 'STRING'),
  ('renewal_invoice_lead_days', 'Billing', 'Số ngày tạo hóa đơn gia hạn trước kỳ mới', 'Khoảng thời gian trước period_start để billing scheduler tạo renewal invoice.', '7'::jsonb, 'INTEGER'),
  ('past_due_warning_days', 'Billing', 'Số ngày cảnh báo quá hạn trước grace period', 'Số ngày subscription ở PAST_DUE trước khi chuyển sang GRACE_PERIOD.', '1'::jsonb, 'INTEGER'),
  ('billing_webhook_processing_timeout_seconds', 'Billing', 'Webhook processing timeout', 'Số giây trước khi một billing webhook PROCESSING được coi là stale và có thể claim lại.', '300'::jsonb, 'INTEGER'),
  ('display_locale', 'Display', 'Locale mặc định', 'Locale dùng để format số, tiền và thời gian trong UI.', '"vi-VN"'::jsonb, 'STRING'),
  ('display_timezone', 'Display', 'Timezone mặc định', 'Timezone nghiệp vụ mặc định của platform.', '"Asia/Ho_Chi_Minh"'::jsonb, 'STRING'),
  ('display_currency_code', 'Display', 'Mã tiền tệ', 'ISO currency code mặc định.', '"VND"'::jsonb, 'STRING'),
  ('display_date_format', 'Display', 'Format ngày', 'Format ngày chuẩn hiển thị trong sản phẩm.', '"dd/MM/yyyy"'::jsonb, 'STRING'),
  ('display_datetime_format', 'Display', 'Format ngày giờ', 'Format ngày giờ chuẩn hiển thị trong sản phẩm.', '"dd/MM/yyyy HH:mm"'::jsonb, 'STRING'),
  ('display_format_presets', 'Display', 'Format presets', 'Các preset format có thể tái sử dụng giữa dashboard/report/export.', '{"date": {"pattern": "dd/MM/yyyy"}, "money": {"style": "currency", "currency": "VND", "maximumFractionDigits": 0}, "integer": {"maximumFractionDigits": 0}, "percent": {"maximumFractionDigits": 1, "minimumFractionDigits": 0}, "dateTime": {"pattern": "dd/MM/yyyy HH:mm"}}'::jsonb, 'JSON'),
  ('dashboard_lease_expiry_days', 'Dashboard', 'Cửa sổ hợp đồng sắp hết hạn', 'Số ngày tương lai dùng để đếm hợp đồng sắp hết hạn trên dashboard.', '30'::jsonb, 'INTEGER'),
  ('dashboard_recent_window_hours', 'Dashboard', 'Cửa sổ dữ liệu gần đây', 'Số giờ dùng cho các KPI gần đây như audit, payment và notification.', '24'::jsonb, 'INTEGER'),
  ('worker_stale_after_seconds', 'Automation', 'Worker stale threshold', 'Số giây không heartbeat trước khi worker được coi là stale trên dashboard.', '60'::jsonb, 'INTEGER'),
  ('brand_product_name', 'Brand', 'Tên sản phẩm', 'Tên thương hiệu hiển thị trên các surface của platform.', '"Habi"'::jsonb, 'STRING'),
  ('brand_product_descriptor', 'Brand', 'Mô tả sản phẩm', 'Mô tả ngắn đi cùng wordmark.', '"SaaS vận hành nhà cho thuê"'::jsonb, 'STRING'),
  ('brand_tagline', 'Brand', 'Tagline', 'Thông điệp thương hiệu ngắn dùng trên dashboard và landing surfaces.', '"Nhà gọn. Việc trôi."'::jsonb, 'STRING'),
  ('brand_palette', 'Brand', 'Bảng màu thương hiệu', 'Design tokens mặc định cho Habi.', '{"navy": "#25355C", "teal": "#35C6A8", "amber": "#FFB36B", "surface": "#FFFFFF", "background": "#F7FAF9"}'::jsonb, 'JSON'),
  ('renter_payment_webhook_processing_timeout_seconds', 'Renter payments', 'Renter payment webhook processing timeout', 'Số giây trước khi renter payment webhook PROCESSING được coi là stale và có thể claim lại.', '300'::jsonb, 'INTEGER'),
  ('google_auth_enabled', 'Identity', 'Đăng nhập Google', 'Cho phép tenant user đăng nhập/đăng ký bằng Google Identity Services.', 'true'::jsonb, 'BOOLEAN'),
  ('password_registration_enabled', 'Security', 'Cho phép self-register bằng mật khẩu', 'Cho phép tenant OWNER mới tự đăng ký bằng email/mật khẩu. Nên tắt ở production cho tới khi có email verification/recovery provider.', 'true'::jsonb, 'BOOLEAN'),
  ('mfa_required_tenant_roles', 'Identity', 'Tenant roles bắt buộc MFA', 'Danh sách role tenant phải hoàn tất MFA trước khi được cấp browser session.', '["OWNER"]'::jsonb, 'JSON'),
  ('mfa_required_platform_roles', 'Identity', 'Platform roles bắt buộc MFA', 'Danh sách role Control Plane phải hoàn tất MFA trước khi được cấp browser session.', '["PLATFORM_ADMIN"]'::jsonb, 'JSON')
ON CONFLICT (key) DO UPDATE
SET group_key = EXCLUDED.group_key,
    label = EXCLUDED.label,
    description = EXCLUDED.description,
    value = EXCLUDED.value,
    value_type = EXCLUDED.value_type;

--
-- Seed default SaaS plans
--

INSERT INTO saas_plans (code, name)
VALUES
  ('STARTER', 'Starter'),
  ('GROWTH', 'Growth'),
  ('PRO', 'Pro'),
  ('BUSINESS', 'Business')
ON CONFLICT (code) DO NOTHING;

WITH target AS (SELECT id FROM saas_plans WHERE code = 'STARTER'),
version_row AS (
  INSERT INTO saas_plan_versions (
    plan_id, version, monthly_price_vnd, yearly_price_vnd,
    room_limit, staff_limit, automation_quota, features, reason
  )
  SELECT id, 1, 99000, 950000, 20, 2, 500,
    '{"leases": true, "billing": true, "pricing": true, "reports": true, "finances": true, "metering": true, "payments": true, "properties": true, "maintenance": true, "notifications": true, "credit_balance": true, "team_management": true}'::jsonb,
    'Initial pricing V1'
  FROM target
  ON CONFLICT (plan_id, version) DO UPDATE
  SET monthly_price_vnd = EXCLUDED.monthly_price_vnd,
      yearly_price_vnd = EXCLUDED.yearly_price_vnd,
      room_limit = EXCLUDED.room_limit,
      staff_limit = EXCLUDED.staff_limit,
      automation_quota = EXCLUDED.automation_quota,
      features = EXCLUDED.features
  RETURNING id, plan_id
)
UPDATE saas_plans p
SET current_version_id = v.id
FROM version_row v
WHERE p.id = v.plan_id;

WITH target AS (SELECT id FROM saas_plans WHERE code = 'GROWTH'),
version_row AS (
  INSERT INTO saas_plan_versions (
    plan_id, version, monthly_price_vnd, yearly_price_vnd,
    room_limit, staff_limit, automation_quota, features, reason
  )
  SELECT id, 1, 249000, 2390000, 60, 5, 1000,
    '{"leases": true, "billing": true, "pricing": true, "reports": true, "finances": true, "metering": true, "payments": true, "properties": true, "maintenance": true, "notifications": true, "credit_balance": true, "team_management": true}'::jsonb,
    'Initial pricing V1'
  FROM target
  ON CONFLICT (plan_id, version) DO UPDATE
  SET monthly_price_vnd = EXCLUDED.monthly_price_vnd,
      yearly_price_vnd = EXCLUDED.yearly_price_vnd,
      room_limit = EXCLUDED.room_limit,
      staff_limit = EXCLUDED.staff_limit,
      automation_quota = EXCLUDED.automation_quota,
      features = EXCLUDED.features
  RETURNING id, plan_id
)
UPDATE saas_plans p
SET current_version_id = v.id
FROM version_row v
WHERE p.id = v.plan_id;

WITH target AS (SELECT id FROM saas_plans WHERE code = 'PRO'),
version_row AS (
  INSERT INTO saas_plan_versions (
    plan_id, version, monthly_price_vnd, yearly_price_vnd,
    room_limit, staff_limit, automation_quota, features, reason
  )
  SELECT id, 1, 499000, 4790000, 150, 10, 5000,
    '{"leases": true, "billing": true, "pricing": true, "reports": true, "finances": true, "metering": true, "payments": true, "properties": true, "maintenance": true, "notifications": true, "credit_balance": true, "team_management": true}'::jsonb,
    'Initial pricing V1'
  FROM target
  ON CONFLICT (plan_id, version) DO UPDATE
  SET monthly_price_vnd = EXCLUDED.monthly_price_vnd,
      yearly_price_vnd = EXCLUDED.yearly_price_vnd,
      room_limit = EXCLUDED.room_limit,
      staff_limit = EXCLUDED.staff_limit,
      automation_quota = EXCLUDED.automation_quota,
      features = EXCLUDED.features
  RETURNING id, plan_id
)
UPDATE saas_plans p
SET current_version_id = v.id
FROM version_row v
WHERE p.id = v.plan_id;

WITH target AS (SELECT id FROM saas_plans WHERE code = 'BUSINESS'),
version_row AS (
  INSERT INTO saas_plan_versions (
    plan_id, version, monthly_price_vnd, yearly_price_vnd,
    room_limit, staff_limit, automation_quota, features, reason
  )
  SELECT id, 1, 799000, 7670000, 300, 20, 15000,
    '{"leases": true, "billing": true, "pricing": true, "reports": true, "finances": true, "metering": true, "payments": true, "properties": true, "maintenance": true, "notifications": true, "credit_balance": true, "team_management": true}'::jsonb,
    'Initial pricing V1'
  FROM target
  ON CONFLICT (plan_id, version) DO UPDATE
  SET monthly_price_vnd = EXCLUDED.monthly_price_vnd,
      yearly_price_vnd = EXCLUDED.yearly_price_vnd,
      room_limit = EXCLUDED.room_limit,
      staff_limit = EXCLUDED.staff_limit,
      automation_quota = EXCLUDED.automation_quota,
      features = EXCLUDED.features
  RETURNING id, plan_id
)
UPDATE saas_plans p
SET current_version_id = v.id
FROM version_row v
WHERE p.id = v.plan_id;
