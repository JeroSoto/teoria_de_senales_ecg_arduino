-- ============================================================
-- Esquema MySQL/MariaDB para ECG + Arduino
-- Importar desde phpMyAdmin (XAMPP) → pestaña "Importar".
-- Equivale a lo que Sequelize crea con DB_SYNC=true.
-- Si lo usas, pon DB_SYNC=false en el archivo .env
-- ============================================================
CREATE DATABASE IF NOT EXISTS `arduino_ecg`
  CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE `arduino_ecg`;

CREATE TABLE IF NOT EXISTS `usuarios` (
  `id`            INT          NOT NULL AUTO_INCREMENT,
  `nombre`        VARCHAR(80)  NOT NULL,
  `email`         VARCHAR(120) NOT NULL,
  `password_hash` VARCHAR(255) NOT NULL,            -- bcrypt, nunca la contraseña en claro
  `rol`           ENUM('admin','usuario') NOT NULL DEFAULT 'usuario',
  `activo`        TINYINT(1)   NOT NULL DEFAULT 1,
  `ultimo_login`  DATETIME     NULL,
  `created_at`    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `email` (`email`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `mediciones` (
  `id`         INT      NOT NULL AUTO_INCREMENT,
  `usuario_id` INT      NOT NULL,
  `bpm`        SMALLINT NOT NULL,
  `fuente`     ENUM('arduino','bluetooth','simulado') NOT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `mediciones_usuario_id` (`usuario_id`),
  CONSTRAINT `mediciones_ibfk_1` FOREIGN KEY (`usuario_id`) REFERENCES `usuarios` (`id`)
    ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `comandos_log` (
  `id`         INT          NOT NULL AUTO_INCREMENT,
  `usuario_id` INT          NOT NULL,
  `comando`    VARCHAR(20)  NOT NULL,
  `valor`      VARCHAR(20)  NULL,
  `exito`      TINYINT(1)   NOT NULL DEFAULT 0,
  `respuesta`  VARCHAR(160) NULL,
  `created_at` DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `comandos_log_usuario_id` (`usuario_id`),
  CONSTRAINT `comandos_log_ibfk_1` FOREIGN KEY (`usuario_id`) REFERENCES `usuarios` (`id`)
    ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
