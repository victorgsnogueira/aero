CREATE TABLE `audit_log` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`actor` varchar(16) NOT NULL,
	`action` varchar(64) NOT NULL,
	`entity` varchar(64) NOT NULL,
	`entity_id` varchar(64),
	`data` json,
	`created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	CONSTRAINT `audit_log_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `campaign_contact_events` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`campaign_contact_id` bigint unsigned NOT NULL,
	`from_status` varchar(32),
	`to_status` varchar(32) NOT NULL,
	`reason` varchar(255),
	`actor` varchar(16) NOT NULL,
	`created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	CONSTRAINT `campaign_contact_events_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `campaign_contacts` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`campaign_id` bigint unsigned NOT NULL,
	`company_id` bigint unsigned NOT NULL,
	`phone_id` bigint unsigned NOT NULL,
	`status` enum('selected','excluded','blocked','scheduled','sent','awaiting_reply','replied','qualifying','qualified','handed_off','declined','closed_no_reply','cancelled') NOT NULL DEFAULT 'selected',
	`status_reason` varchar(255),
	`offer_snapshot` json,
	`qualification_index` int NOT NULL DEFAULT 0,
	`answers` json,
	`first_message_id` bigint unsigned,
	`first_sent_at` datetime(3),
	`replied_at` datetime(3),
	`closed_at` datetime(3),
	`created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`updated_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	CONSTRAINT `campaign_contacts_id` PRIMARY KEY(`id`),
	CONSTRAINT `campaign_contacts_uq` UNIQUE(`campaign_id`,`phone_id`)
);
--> statement-breakpoint
CREATE TABLE `campaigns` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`name` varchar(160) NOT NULL,
	`objective` text,
	`service` enum('landing_page','micro_saas') NOT NULL,
	`offer_id` bigint unsigned,
	`status` enum('draft','active','paused','completed','cancelled') NOT NULL DEFAULT 'draft',
	`session_id` bigint unsigned,
	`audience_filters` json,
	`first_message_template` text,
	`presentation_template` text,
	`qualification_questions` json,
	`questions_per_message` int NOT NULL DEFAULT 1,
	`qualification_done_template` text,
	`decline_ack_template` text,
	`timezone` varchar(64) NOT NULL DEFAULT 'America/Sao_Paulo',
	`send_days` json NOT NULL,
	`send_window_start` varchar(5) NOT NULL DEFAULT '09:00',
	`send_window_end` varchar(5) NOT NULL DEFAULT '18:00',
	`daily_limit` int NOT NULL DEFAULT 20,
	`no_reply_close_hours` int NOT NULL DEFAULT 72,
	`started_at` datetime(3),
	`paused_at` datetime(3),
	`ended_at` datetime(3),
	`last_dispatch_at` datetime(3),
	`is_demo` boolean NOT NULL DEFAULT false,
	`created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`updated_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	CONSTRAINT `campaigns_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `companies` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`source` varchar(32) NOT NULL DEFAULT 'google_maps',
	`source_place_id` varchar(191),
	`source_cid` varchar(64),
	`source_data_id` varchar(128),
	`name` varchar(255) NOT NULL,
	`category` varchar(191),
	`address` varchar(512),
	`neighborhood` varchar(160),
	`city` varchar(160),
	`state` varchar(120),
	`postal_code` varchar(32),
	`country_code` varchar(2),
	`website` varchar(512),
	`domain` varchar(191),
	`maps_url` varchar(1024),
	`latitude` decimal(10,7),
	`longitude` decimal(10,7),
	`rating` decimal(3,2),
	`review_count` int,
	`timezone` varchar(64),
	`raw` json,
	`notes` text,
	`is_demo` boolean NOT NULL DEFAULT false,
	`first_seen_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`last_seen_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`updated_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	CONSTRAINT `companies_id` PRIMARY KEY(`id`),
	CONSTRAINT `companies_source_place_uq` UNIQUE(`source`,`source_place_id`)
);
--> statement-breakpoint
CREATE TABLE `company_phones` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`company_id` bigint unsigned NOT NULL,
	`phone_id` bigint unsigned NOT NULL,
	`raw_value` varchar(64) NOT NULL,
	`source` varchar(32) NOT NULL DEFAULT 'google_maps',
	`is_primary` boolean NOT NULL DEFAULT true,
	`created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	CONSTRAINT `company_phones_id` PRIMARY KEY(`id`),
	CONSTRAINT `company_phones_uq` UNIQUE(`company_id`,`phone_id`)
);
--> statement-breakpoint
CREATE TABLE `conversations` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`session_id` bigint unsigned NOT NULL,
	`phone_id` bigint unsigned NOT NULL,
	`jid` varchar(128) NOT NULL,
	`lid` varchar(128),
	`display_name` varchar(255),
	`state` enum('awaiting_reply','awaiting_human','human','closed') NOT NULL DEFAULT 'awaiting_reply',
	`automation_paused` boolean NOT NULL DEFAULT false,
	`active_campaign_contact_id` bigint unsigned,
	`unread_count` int NOT NULL DEFAULT 0,
	`last_message_at` datetime(3),
	`last_inbound_at` datetime(3),
	`next_action` varchar(255),
	`next_action_due_at` datetime(3),
	`notes` text,
	`version` int NOT NULL DEFAULT 0,
	`created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`updated_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	CONSTRAINT `conversations_id` PRIMARY KEY(`id`),
	CONSTRAINT `conversations_session_phone_uq` UNIQUE(`session_id`,`phone_id`)
);
--> statement-breakpoint
CREATE TABLE `messages` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`conversation_id` bigint unsigned NOT NULL,
	`direction` enum('in','out') NOT NULL,
	`origin` enum('automatic','manual','phone','contact') NOT NULL,
	`status` enum('scheduled','processing','accepted','delivered','read','failed','unknown','cancelled','received') NOT NULL,
	`kind` varchar(32) NOT NULL DEFAULT 'text',
	`body` text,
	`media` json,
	`campaign_id` bigint unsigned,
	`campaign_contact_id` bigint unsigned,
	`purpose` varchar(32),
	`external_id` varchar(128),
	`idempotency_key` varchar(128),
	`scheduled_for` datetime(3),
	`sent_at` datetime(3),
	`delivered_at` datetime(3),
	`read_at` datetime(3),
	`occurred_at` datetime(3) NOT NULL,
	`error` varchar(512),
	`attempts` int NOT NULL DEFAULT 0,
	`locked_at` datetime(3),
	`created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`updated_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	CONSTRAINT `messages_id` PRIMARY KEY(`id`),
	CONSTRAINT `messages_external_uq` UNIQUE(`conversation_id`,`external_id`),
	CONSTRAINT `messages_idem_uq` UNIQUE(`idempotency_key`)
);
--> statement-breakpoint
CREATE TABLE `offers` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`service` enum('landing_page','micro_saas') NOT NULL,
	`name` varchar(160) NOT NULL,
	`description` text,
	`scope` text,
	`price_type` enum('fixed','starting_at','custom_quote') NOT NULL,
	`price_cents` bigint,
	`setup_cents` bigint,
	`monthly_cents` bigint,
	`currency` varchar(3) NOT NULL DEFAULT 'BRL',
	`conditions` text,
	`valid_until` varchar(10),
	`archived` boolean NOT NULL DEFAULT false,
	`created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`updated_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	CONSTRAINT `offers_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `operator_settings` (
	`id` int NOT NULL,
	`sender_name` varchar(120),
	`company_name` varchar(160),
	`introduction` text,
	`default_timezone` varchar(64) NOT NULL DEFAULT 'America/Sao_Paulo',
	`default_country` varchar(2) NOT NULL DEFAULT 'BR',
	`send_min_interval_seconds` int NOT NULL DEFAULT 90,
	`send_daily_limit` int NOT NULL DEFAULT 40,
	`send_hourly_limit` int NOT NULL DEFAULT 12,
	`validation_revalidate_days` int NOT NULL DEFAULT 30,
	`validation_batch_size` int NOT NULL DEFAULT 10,
	`validation_min_interval_ms` int NOT NULL DEFAULT 4000,
	`scan_default_depth` int NOT NULL DEFAULT 10,
	`scan_unit_max_seconds` int NOT NULL DEFAULT 600,
	`updated_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	CONSTRAINT `operator_settings_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `opportunities` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`company_id` bigint unsigned NOT NULL,
	`conversation_id` bigint unsigned,
	`campaign_id` bigint unsigned,
	`campaign_contact_id` bigint unsigned,
	`service` enum('landing_page','micro_saas') NOT NULL,
	`title` varchar(255) NOT NULL,
	`stage` enum('presentation','qualification','proposal','negotiation','won','lost') NOT NULL,
	`lost_reason` varchar(255),
	`offer_snapshot` json,
	`qualification_answers` json,
	`notes` text,
	`next_action` varchar(255),
	`next_action_due_at` datetime(3),
	`won_at` datetime(3),
	`lost_at` datetime(3),
	`created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`updated_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	CONSTRAINT `opportunities_id` PRIMARY KEY(`id`),
	CONSTRAINT `opportunities_cc_uq` UNIQUE(`campaign_contact_id`)
);
--> statement-breakpoint
CREATE TABLE `opportunity_stage_history` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`opportunity_id` bigint unsigned NOT NULL,
	`from_stage` varchar(32),
	`to_stage` varchar(32) NOT NULL,
	`reason` varchar(255),
	`actor` varchar(16) NOT NULL,
	`created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	CONSTRAINT `opportunity_stage_history_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `outbox` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`topic` varchar(64) NOT NULL,
	`payload` json NOT NULL,
	`dedupe_key` varchar(191),
	`available_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`published_at` datetime(3),
	`attempts` int NOT NULL DEFAULT 0,
	`last_error` varchar(512),
	`created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	CONSTRAINT `outbox_id` PRIMARY KEY(`id`),
	CONSTRAINT `outbox_dedupe_uq` UNIQUE(`dedupe_key`)
);
--> statement-breakpoint
CREATE TABLE `payments` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`proposal_id` bigint unsigned NOT NULL,
	`amount_cents` bigint NOT NULL,
	`currency` varchar(3) NOT NULL,
	`received_at` datetime(3) NOT NULL,
	`method` varchar(64),
	`note` varchar(255),
	`created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	CONSTRAINT `payments_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `phones` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`e164` varchar(20),
	`dedupe_key` varchar(64) NOT NULL,
	`raw_sample` varchar(64) NOT NULL,
	`country_code` varchar(2),
	`format_status` enum('valid','needs_review','invalid') NOT NULL,
	`format_note` varchar(255),
	`line_type` varchar(32),
	`wa_status` enum('pending','invalid_format','found','not_found','inconclusive') NOT NULL DEFAULT 'pending',
	`wa_jid` varchar(128),
	`wa_checked_at` datetime(3),
	`wa_error` varchar(255),
	`wa_attempts` int NOT NULL DEFAULT 0,
	`created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`updated_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	CONSTRAINT `phones_id` PRIMARY KEY(`id`),
	CONSTRAINT `phones_dedupe_uq` UNIQUE(`dedupe_key`)
);
--> statement-breakpoint
CREATE TABLE `proposals` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`opportunity_id` bigint unsigned NOT NULL,
	`service` enum('landing_page','micro_saas') NOT NULL,
	`title` varchar(255) NOT NULL,
	`scope` text,
	`amount_cents` bigint NOT NULL,
	`setup_cents` bigint,
	`monthly_cents` bigint,
	`currency` varchar(3) NOT NULL,
	`conditions` text,
	`valid_until` varchar(10),
	`origin` varchar(64),
	`status` enum('draft','sent','accepted','rejected','expired','withdrawn') NOT NULL DEFAULT 'draft',
	`sent_at` datetime(3),
	`accepted_at` datetime(3),
	`rejected_at` datetime(3),
	`created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`updated_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	CONSTRAINT `proposals_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `scan_query_log` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`query_hash` varchar(64) NOT NULL,
	`query` varchar(512) NOT NULL,
	`language` varchar(2) NOT NULL,
	`depth` int NOT NULL,
	`scan_unit_id` bigint unsigned NOT NULL,
	`places_found` int NOT NULL DEFAULT 0,
	`created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	CONSTRAINT `scan_query_log_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `scan_results` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`scan_id` bigint unsigned NOT NULL,
	`scan_unit_id` bigint unsigned NOT NULL,
	`company_id` bigint unsigned NOT NULL,
	`is_new` boolean NOT NULL,
	`is_surplus` boolean NOT NULL DEFAULT false,
	`counts_toward_target` boolean NOT NULL DEFAULT false,
	`created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	CONSTRAINT `scan_results_id` PRIMARY KEY(`id`),
	CONSTRAINT `scan_results_uq` UNIQUE(`scan_id`,`company_id`)
);
--> statement-breakpoint
CREATE TABLE `scan_units` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`scan_id` bigint unsigned NOT NULL,
	`seq` int NOT NULL,
	`query` varchar(512) NOT NULL,
	`depth` int NOT NULL,
	`status` enum('pending','submitted','running','importing','done','failed','skipped','abandoned') NOT NULL DEFAULT 'pending',
	`external_job_id` varchar(64),
	`attempts` int NOT NULL DEFAULT 0,
	`places_found` int NOT NULL DEFAULT 0,
	`new_records` int NOT NULL DEFAULT 0,
	`duplicates` int NOT NULL DEFAULT 0,
	`error` text,
	`submitted_at` datetime(3),
	`finished_at` datetime(3),
	`created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`updated_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	CONSTRAINT `scan_units_id` PRIMARY KEY(`id`),
	CONSTRAINT `scan_units_seq_uq` UNIQUE(`scan_id`,`seq`)
);
--> statement-breakpoint
CREATE TABLE `scans` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`name` varchar(160) NOT NULL,
	`segment` varchar(160),
	`category` varchar(160),
	`keywords` json NOT NULL,
	`neighborhood` varchar(160),
	`city` varchar(160),
	`state` varchar(120),
	`country` varchar(120),
	`country_code` varchar(2),
	`language` varchar(2) NOT NULL DEFAULT 'pt',
	`mode` enum('collect_only','collect_and_validate') NOT NULL,
	`target_kind` enum('unique_phones','whatsapp_confirmed') NOT NULL,
	`target_count` int NOT NULL,
	`campaign_id` bigint unsigned,
	`depth` int NOT NULL DEFAULT 10,
	`unit_max_seconds` int NOT NULL DEFAULT 600,
	`max_units` int NOT NULL DEFAULT 20,
	`max_duration_minutes` int NOT NULL DEFAULT 180,
	`status` enum('draft','queued','running','pausing','paused','cancelling','cancelled','completed','partial','failed') NOT NULL DEFAULT 'draft',
	`status_reason` varchar(512),
	`last_error` text,
	`places_found` int NOT NULL DEFAULT 0,
	`phones_found` int NOT NULL DEFAULT 0,
	`new_records` int NOT NULL DEFAULT 0,
	`duplicates` int NOT NULL DEFAULT 0,
	`unique_phones` int NOT NULL DEFAULT 0,
	`wa_confirmed` int NOT NULL DEFAULT 0,
	`wa_inconclusive` int NOT NULL DEFAULT 0,
	`surplus` int NOT NULL DEFAULT 0,
	`started_at` datetime(3),
	`finished_at` datetime(3),
	`created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`updated_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	CONSTRAINT `scans_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `suppressions` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`phone_id` bigint unsigned NOT NULL,
	`reason` varchar(64) NOT NULL,
	`detail` text,
	`source_message_id` bigint unsigned,
	`campaign_id` bigint unsigned,
	`created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`lifted_at` datetime(3),
	`lifted_reason` varchar(255),
	CONSTRAINT `suppressions_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `wa_sessions` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`session_key` varchar(64) NOT NULL,
	`label` varchar(120) NOT NULL,
	`status` enum('unknown','not_created','connecting','scan_qr','connected','disconnected','stopped','logged_out','gateway_unreachable') NOT NULL DEFAULT 'unknown',
	`own_jid` varchar(128),
	`webhook_registered_at` datetime(3),
	`last_event_at` datetime(3),
	`last_error` varchar(512),
	`created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`updated_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	CONSTRAINT `wa_sessions_id` PRIMARY KEY(`id`),
	CONSTRAINT `wa_sessions_session_key_unique` UNIQUE(`session_key`)
);
--> statement-breakpoint
CREATE TABLE `webhook_events` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`source` varchar(32) NOT NULL,
	`event_key` varchar(191) NOT NULL,
	`event` varchar(64) NOT NULL,
	`payload` json NOT NULL,
	`created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`processed_at` datetime(3),
	`attempts` int NOT NULL DEFAULT 0,
	`error` text,
	CONSTRAINT `webhook_events_id` PRIMARY KEY(`id`),
	CONSTRAINT `webhook_events_key_uq` UNIQUE(`source`,`event_key`)
);
--> statement-breakpoint
CREATE INDEX `audit_entity_idx` ON `audit_log` (`entity`,`entity_id`);--> statement-breakpoint
CREATE INDEX `audit_created_idx` ON `audit_log` (`created_at`);--> statement-breakpoint
CREATE INDEX `cce_cc_idx` ON `campaign_contact_events` (`campaign_contact_id`);--> statement-breakpoint
CREATE INDEX `campaign_contacts_phone_idx` ON `campaign_contacts` (`phone_id`,`status`);--> statement-breakpoint
CREATE INDEX `campaign_contacts_status_idx` ON `campaign_contacts` (`campaign_id`,`status`);--> statement-breakpoint
CREATE INDEX `campaigns_status_idx` ON `campaigns` (`status`);--> statement-breakpoint
CREATE INDEX `companies_cid_idx` ON `companies` (`source_cid`);--> statement-breakpoint
CREATE INDEX `companies_domain_idx` ON `companies` (`domain`);--> statement-breakpoint
CREATE INDEX `companies_city_idx` ON `companies` (`country_code`,`state`,`city`);--> statement-breakpoint
CREATE INDEX `companies_category_idx` ON `companies` (`category`);--> statement-breakpoint
CREATE INDEX `companies_geo_idx` ON `companies` (`latitude`,`longitude`);--> statement-breakpoint
CREATE INDEX `companies_name_idx` ON `companies` (`name`);--> statement-breakpoint
CREATE INDEX `company_phones_phone_idx` ON `company_phones` (`phone_id`);--> statement-breakpoint
CREATE INDEX `conversations_last_idx` ON `conversations` (`last_message_at`);--> statement-breakpoint
CREATE INDEX `conversations_state_idx` ON `conversations` (`state`);--> statement-breakpoint
CREATE INDEX `messages_conv_idx` ON `messages` (`conversation_id`,`occurred_at`);--> statement-breakpoint
CREATE INDEX `messages_sched_idx` ON `messages` (`status`,`scheduled_for`);--> statement-breakpoint
CREATE INDEX `messages_campaign_idx` ON `messages` (`campaign_id`,`purpose`);--> statement-breakpoint
CREATE INDEX `messages_external_idx` ON `messages` (`external_id`);--> statement-breakpoint
CREATE INDEX `opportunities_stage_idx` ON `opportunities` (`stage`);--> statement-breakpoint
CREATE INDEX `opportunities_company_idx` ON `opportunities` (`company_id`);--> statement-breakpoint
CREATE INDEX `opportunities_campaign_idx` ON `opportunities` (`campaign_id`);--> statement-breakpoint
CREATE INDEX `osh_opp_idx` ON `opportunity_stage_history` (`opportunity_id`);--> statement-breakpoint
CREATE INDEX `outbox_pending_idx` ON `outbox` (`published_at`,`available_at`);--> statement-breakpoint
CREATE INDEX `payments_proposal_idx` ON `payments` (`proposal_id`);--> statement-breakpoint
CREATE INDEX `phones_e164_idx` ON `phones` (`e164`);--> statement-breakpoint
CREATE INDEX `phones_wa_idx` ON `phones` (`wa_status`,`wa_checked_at`);--> statement-breakpoint
CREATE INDEX `proposals_opp_idx` ON `proposals` (`opportunity_id`);--> statement-breakpoint
CREATE INDEX `proposals_status_idx` ON `proposals` (`status`);--> statement-breakpoint
CREATE INDEX `scan_query_log_hash_idx` ON `scan_query_log` (`query_hash`,`created_at`);--> statement-breakpoint
CREATE INDEX `scan_results_company_idx` ON `scan_results` (`company_id`);--> statement-breakpoint
CREATE INDEX `scan_units_status_idx` ON `scan_units` (`status`);--> statement-breakpoint
CREATE INDEX `scans_status_idx` ON `scans` (`status`);--> statement-breakpoint
CREATE INDEX `suppressions_phone_idx` ON `suppressions` (`phone_id`,`lifted_at`);--> statement-breakpoint
CREATE INDEX `webhook_events_pending_idx` ON `webhook_events` (`processed_at`);