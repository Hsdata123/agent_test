-- QianchuanDailySnapshot 表 DDL（MySQL 8.0+）
-- 数据库: oceanengine_api
-- 用途: 千川素材/账户逐日数据快照,供技能 DB 优先查询

CREATE TABLE IF NOT EXISTS QianchuanDailySnapshot (
  id              BIGINT AUTO_INCREMENT PRIMARY KEY,
  advertiserId    VARCHAR(32) NOT NULL,
  anchorId        VARCHAR(32) NOT NULL DEFAULT '',
  anchorName      VARCHAR(255) DEFAULT '',
  materialId      VARCHAR(64) NOT NULL,
  materialName    VARCHAR(500) DEFAULT '',
  videoType       VARCHAR(64) DEFAULT '',
  statDate        VARCHAR(20) NOT NULL,
  smartBidType    VARCHAR(8) NOT NULL DEFAULT '0',
  cost            DECIMAL(20,4) DEFAULT 0,
  gmv             DECIMAL(20,4) DEFAULT 0,
  orderCount      DECIMAL(20,4) DEFAULT 0,
  roi2            DECIMAL(10,4) DEFAULT 0,
  couponAmount    DECIMAL(20,4) DEFAULT 0,
  subsidyAmount   DECIMAL(20,4) DEFAULT 0,
  showCount       DECIMAL(20,4) DEFAULT 0,
  clickCount      DECIMAL(20,4) DEFAULT 0,
  ecpm            DECIMAL(20,4) DEFAULT 0,
  cpc             DECIMAL(20,4) DEFAULT 0,
  source          VARCHAR(16) NOT NULL DEFAULT 'api',
  syncedAt        DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  createdAt       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updatedAt       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_snapshot (advertiserId, anchorId, materialId, statDate, smartBidType),
  KEY idx_anchor_date (advertiserId, anchorId, statDate),
  KEY idx_advertiser_date (advertiserId, statDate)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
