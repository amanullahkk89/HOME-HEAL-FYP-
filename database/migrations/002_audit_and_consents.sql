-- Migration 002: Enforce explicit consent timestamps, location freshness indexes, and audit triggers

USE homeheal_east_city;

ALTER TABLE nurse_profiles
  ADD INDEX idx_nurse_location_freshness (location_updated_at);

ALTER TABLE service_requests
  ADD INDEX idx_requests_active_nurse_status (assigned_nurse_id, status);

DELIMITER $$
CREATE PROCEDURE sp_accept_nurse_request(
  IN p_request_id BIGINT UNSIGNED,
  IN p_nurse_id BIGINT UNSIGNED,
  OUT p_outcome VARCHAR(40)
)
BEGIN
  DECLARE v_status VARCHAR(20);
  DECLARE v_assigned BIGINT UNSIGNED;
  DECLARE v_verified VARCHAR(20);
  DECLARE v_active_count INT DEFAULT 0;

  START TRANSACTION;

  SELECT verification_status INTO v_verified
  FROM nurse_profiles
  WHERE user_id = p_nurse_id
  FOR UPDATE;

  SELECT COUNT(*) INTO v_active_count
  FROM service_requests
  WHERE assigned_nurse_id = p_nurse_id
    AND status IN ('Accepted', 'En Route', 'Arrived')
  FOR UPDATE;

  SELECT status, assigned_nurse_id INTO v_status, v_assigned
  FROM service_requests
  WHERE id = p_request_id
  FOR UPDATE;

  IF v_verified <> 'approved' THEN
    ROLLBACK;
    SET p_outcome = 'NURSE_NOT_APPROVED';
  ELSEIF v_active_count > 0 THEN
    ROLLBACK;
    SET p_outcome = 'NURSE_ALREADY_ASSIGNED';
  ELSEIF v_status <> 'Pending' OR v_assigned IS NOT NULL THEN
    ROLLBACK;
    SET p_outcome = 'REQUEST_ALREADY_CLAIMED';
  ELSE
    UPDATE service_requests
    SET assigned_nurse_id = p_nurse_id,
        status = 'Accepted',
        accepted_at = CURRENT_TIMESTAMP
    WHERE id = p_request_id
      AND status = 'Pending'
      AND assigned_nurse_id IS NULL;

    UPDATE request_offers
    SET offer_status = CASE WHEN nurse_id = p_nurse_id THEN 'accepted' ELSE 'superseded' END,
        responded_at = CASE WHEN nurse_id = p_nurse_id THEN CURRENT_TIMESTAMP ELSE responded_at END
    WHERE request_id = p_request_id;

    COMMIT;
    SET p_outcome = 'ACCEPTED';
  END IF;
END$$
DELIMITER ;
