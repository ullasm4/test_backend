-- migrate:up transaction:false

-- Fail fast on lock wait so we can retry instead of deadlocking for long.
SET lock_timeout = '3s';
SET deadlock_timeout = '100ms';

-- contract_ministry
DROP TRIGGER IF EXISTS trigger_update_total_contracts_from_ministries ON contract_ministry;
DROP TRIGGER IF EXISTS trigger_update_total_ministries_count ON contract_ministry;

-- new_buyer_details
DROP TRIGGER IF EXISTS trigger_update_new_buyers_count ON new_buyer_details;
DROP TRIGGER IF EXISTS trigger_update_new_buyers_with_email ON new_buyer_details;

-- new_contracts
DROP TRIGGER IF EXISTS trigger_sync_contract_lookups ON new_contracts;
DROP TRIGGER IF EXISTS trigger_update_contract_value_bucket_counts ON new_contracts;
DROP TRIGGER IF EXISTS trigger_update_contracts_period_counts ON new_contracts;
DROP TRIGGER IF EXISTS trigger_update_new_contracts_bid_present_count ON new_contracts;
DROP TRIGGER IF EXISTS trigger_update_new_contracts_count ON new_contracts;
DROP TRIGGER IF EXISTS trigger_update_new_party_counts ON new_contracts;

-- new_seller_details
DROP TRIGGER IF EXISTS trigger_update_new_sellers_count ON new_seller_details;

-- new_seller_information
DROP TRIGGER IF EXISTS trigger_update_new_sellers_with_phone ON new_seller_information;

-- migrate:down

CREATE TRIGGER trigger_update_total_contracts_from_ministries
AFTER UPDATE OF total_contract OR DELETE ON contract_ministry
FOR EACH ROW
EXECUTE FUNCTION update_total_contracts_from_ministries();

CREATE TRIGGER trigger_update_total_ministries_count
AFTER INSERT OR DELETE ON contract_ministry
FOR EACH ROW
EXECUTE FUNCTION update_total_ministries_count();

CREATE TRIGGER trigger_update_new_buyers_count
AFTER INSERT OR DELETE ON new_buyer_details
FOR EACH ROW
EXECUTE FUNCTION update_new_buyers_count();

CREATE TRIGGER trigger_update_new_buyers_with_email
AFTER INSERT OR DELETE OR UPDATE OF email ON new_buyer_details
FOR EACH ROW
EXECUTE FUNCTION update_new_buyers_with_email_count();

CREATE TRIGGER trigger_sync_contract_lookups
AFTER INSERT OR DELETE OR UPDATE OF org_name, org_type, department, buying_mode
ON new_contracts
FOR EACH ROW
EXECUTE FUNCTION sync_contract_lookups();

CREATE TRIGGER trigger_update_contract_value_bucket_counts
AFTER INSERT OR DELETE OR UPDATE OF total_value ON new_contracts
FOR EACH ROW
EXECUTE FUNCTION update_contract_value_bucket_counts();

CREATE TRIGGER trigger_update_contracts_period_counts
AFTER INSERT OR DELETE ON new_contracts
FOR EACH ROW
EXECUTE FUNCTION update_contracts_period_counts();

CREATE TRIGGER trigger_update_new_contracts_bid_present_count
AFTER INSERT OR DELETE OR UPDATE OF bid_number ON new_contracts
FOR EACH ROW
EXECUTE FUNCTION update_new_contracts_bid_present_count();

CREATE TRIGGER trigger_update_new_contracts_count
AFTER INSERT OR DELETE ON new_contracts
FOR EACH ROW
EXECUTE FUNCTION update_new_contracts_count();

CREATE TRIGGER trigger_update_new_party_counts
AFTER INSERT OR DELETE OR UPDATE OF seller_id, buyer_id, total_value ON new_contracts
FOR EACH ROW
EXECUTE FUNCTION update_new_party_counts_from_contracts();

CREATE TRIGGER trigger_update_new_sellers_count
AFTER INSERT OR DELETE ON new_seller_details
FOR EACH ROW
EXECUTE FUNCTION update_new_sellers_count();

CREATE TRIGGER trigger_update_new_sellers_with_phone
AFTER INSERT OR DELETE OR UPDATE OF phone, seller_id ON new_seller_information
FOR EACH ROW
EXECUTE FUNCTION update_new_sellers_with_phone_count();
