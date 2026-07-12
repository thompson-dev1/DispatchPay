CREATE TABLE `businesses` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`email` text NOT NULL,
	`created_at` integer DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` integer DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `businesses_email_unique` ON `businesses` (`email`);--> statement-breakpoint
CREATE TABLE `deliveries` (
	`id` text PRIMARY KEY NOT NULL,
	`business_id` text NOT NULL,
	`rider_id` text,
	`tracking_number` text NOT NULL,
	`status` text DEFAULT 'PENDING' NOT NULL,
	`pickup_address` text NOT NULL,
	`delivery_address` text NOT NULL,
	`pickup_latitude` real,
	`pickup_longitude` real,
	`delivery_latitude` real,
	`delivery_longitude` real,
	`distance_km` real,
	`fee_amount_minor` integer NOT NULL,
	`commission_amount_minor` integer NOT NULL,
	`payout_amount_minor` integer NOT NULL,
	`created_at` integer DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` integer DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`business_id`) REFERENCES `businesses`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`rider_id`) REFERENCES `riders`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `deliveries_tracking_number_unique` ON `deliveries` (`tracking_number`);--> statement-breakpoint
CREATE INDEX `deliveries_business_idx` ON `deliveries` (`business_id`);--> statement-breakpoint
CREATE INDEX `deliveries_rider_idx` ON `deliveries` (`rider_id`);--> statement-breakpoint
CREATE INDEX `deliveries_status_idx` ON `deliveries` (`status`);--> statement-breakpoint
CREATE TABLE `delivery_status_history` (
	`id` text PRIMARY KEY NOT NULL,
	`delivery_id` text NOT NULL,
	`status` text NOT NULL,
	`changed_by_id` text NOT NULL,
	`latitude` real,
	`longitude` real,
	`notes` text,
	`created_at` integer DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`delivery_id`) REFERENCES `deliveries`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`changed_by_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE INDEX `delivery_status_history_delivery_idx` ON `delivery_status_history` (`delivery_id`);--> statement-breakpoint
CREATE TABLE `ledger_entries` (
	`id` text PRIMARY KEY NOT NULL,
	`wallet_id` text NOT NULL,
	`type` text NOT NULL,
	`amount_minor` integer NOT NULL,
	`balance_after_minor` integer NOT NULL,
	`reference_type` text NOT NULL,
	`reference_id` text NOT NULL,
	`description` text NOT NULL,
	`created_at` integer DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`wallet_id`) REFERENCES `wallets`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE INDEX `ledger_entries_wallet_idx` ON `ledger_entries` (`wallet_id`);--> statement-breakpoint
CREATE INDEX `ledger_entries_reference_idx` ON `ledger_entries` (`reference_type`,`reference_id`);--> statement-breakpoint
CREATE TABLE `otp_verifications` (
	`id` text PRIMARY KEY NOT NULL,
	`phone_number` text NOT NULL,
	`code` text NOT NULL,
	`purpose` text NOT NULL,
	`status` text DEFAULT 'PENDING' NOT NULL,
	`expires_at` integer NOT NULL,
	`created_at` integer DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE INDEX `otp_verifications_phone_code_idx` ON `otp_verifications` (`phone_number`,`code`);--> statement-breakpoint
CREATE TABLE `payments` (
	`id` text PRIMARY KEY NOT NULL,
	`business_id` text NOT NULL,
	`amount_minor` integer NOT NULL,
	`currency` text DEFAULT 'GHS' NOT NULL,
	`status` text DEFAULT 'PENDING' NOT NULL,
	`payment_method` text NOT NULL,
	`provider_reference` text,
	`metadata` text,
	`created_at` integer DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` integer DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`business_id`) REFERENCES `businesses`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE INDEX `payments_business_idx` ON `payments` (`business_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `payments_provider_ref_idx` ON `payments` (`provider_reference`);--> statement-breakpoint
CREATE TABLE `payouts` (
	`id` text PRIMARY KEY NOT NULL,
	`business_id` text NOT NULL,
	`rider_id` text NOT NULL,
	`amount_minor` integer NOT NULL,
	`currency` text DEFAULT 'GHS' NOT NULL,
	`status` text DEFAULT 'PENDING' NOT NULL,
	`recipient_phone` text NOT NULL,
	`recipient_network` text NOT NULL,
	`provider_reference` text,
	`error_message` text,
	`created_at` integer DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` integer DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`business_id`) REFERENCES `businesses`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`rider_id`) REFERENCES `riders`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE INDEX `payouts_rider_idx` ON `payouts` (`rider_id`);--> statement-breakpoint
CREATE INDEX `payouts_business_idx` ON `payouts` (`business_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `payouts_provider_ref_idx` ON `payouts` (`provider_reference`);--> statement-breakpoint
CREATE TABLE `riders` (
	`id` text PRIMARY KEY NOT NULL,
	`business_id` text NOT NULL,
	`first_name` text NOT NULL,
	`last_name` text NOT NULL,
	`vehicle_type` text NOT NULL,
	`vehicle_plate` text,
	`momo_network` text NOT NULL,
	`momo_number` text NOT NULL,
	`created_at` integer DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` integer DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`business_id`) REFERENCES `businesses`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `riders_business_id_idx` ON `riders` (`business_id`);--> statement-breakpoint
CREATE TABLE `sms_logs` (
	`id` text PRIMARY KEY NOT NULL,
	`phone_number` text NOT NULL,
	`message` text NOT NULL,
	`provider_reference` text,
	`status` text DEFAULT 'PENDING' NOT NULL,
	`error_message` text,
	`created_at` integer DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE INDEX `sms_logs_phone_idx` ON `sms_logs` (`phone_number`);--> statement-breakpoint
CREATE TABLE `users` (
	`id` text PRIMARY KEY NOT NULL,
	`email` text,
	`phone_number` text,
	`password_hash` text,
	`role` text NOT NULL,
	`business_id` text,
	`is_active` integer DEFAULT true NOT NULL,
	`created_at` integer DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` integer DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`business_id`) REFERENCES `businesses`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `users_email_unique` ON `users` (`email`);--> statement-breakpoint
CREATE UNIQUE INDEX `users_phone_number_unique` ON `users` (`phone_number`);--> statement-breakpoint
CREATE INDEX `users_role_idx` ON `users` (`role`);--> statement-breakpoint
CREATE INDEX `users_business_id_idx` ON `users` (`business_id`);--> statement-breakpoint
CREATE TABLE `wallets` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`owner_type` text NOT NULL,
	`balance_minor` integer DEFAULT 0 NOT NULL,
	`currency` text DEFAULT 'GHS' NOT NULL,
	`created_at` integer DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` integer DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `wallets_owner_idx` ON `wallets` (`owner_id`,`owner_type`);