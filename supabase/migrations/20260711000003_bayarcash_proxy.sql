-- Enable http extension for external API calls
CREATE EXTENSION IF NOT EXISTS http WITH SCHEMA extensions;

-- Function: Create Bayarcash payment intent from database
CREATE OR REPLACE FUNCTION create_bayarcash_payment(
  p_booking_id UUID,
  p_amount INTEGER,
  p_name TEXT,
  p_phone TEXT,
  p_return_url TEXT
) RETURNS TEXT
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = 'public'
AS $$
DECLARE
  v_response JSONB;
  v_url TEXT;
BEGIN
  SELECT content::JSONB INTO v_response
  FROM http((
    'POST',
    'https://api.console.bayar.cash/v3/payment-intents',
    ARRAY[http_header('Authorization','Bearer eyJ0eXAiOiJKV1QiLCJhbGciOiJSUzI1NiJ9.eyJhdWQiOiI1IiwianRpIjoiZWQyZjJkYTA3OTY4ZDRhZjYwZTllMDRkY2E5MTFjMWUyMjNkYmEzYWZiZmIwZjYzODQ3MDRiZjcwYTJhZjViZDVjODEyMWUwNzNjNTY1NGEiLCJpYXQiOjE3MzAxNzI5ODcuNDY5NDk2LCJuYmYiOjE3MzAxNzI5ODcuNDY5NDk5LCJleHAiOjIwNDU3MDU3ODcuNDY4NjY4LCJzdWIiOiI1NjUiLCJzY29wZXMiOlsiKiJdfQ.Z5Yig6tTybTvmuEd2Q-LE2OL0vGgpeR0VzaRisJiW9P2ZPOtQDEoSJ_Dq--pWxJt8YliZlQfUgiYbBStJnqZiKXrxmQ_09mQ7dWz1WbwCiK2W5aJiLp4dXGJOvkh9uwWxIiWb20Fvh1qLw6peXU_-695obcEGPpRD4SF2wdcIFNfHk4LTz8QVigG9nunrJ8iFCziFP-KlSvi3V_QIkFJJ_onRcSxRiTWpScb7dn29QmG6SrvWrbaZHJWArLtoYmiEskwH7T2GUrkdTS9orXRouhamfb_1n4PaIMdRJ7CSujJZfNCFWBq0JLc3tp__h_48mf7l8OoGA5IFzPkQGgxXew583A7YwhGrobqNo2uD5P90YeLF_uLtjy6cz1sC7ydGOTPzYH_jdh5WXTDxOCbIRff3oRlUA5HYxj0mBiafOm8fTq42wdKgGZe6DabcOpTJ9TQ_J2JeSIpQ2smfgD4rqRZPCLYzOsx_EbqSO2OhwnMkjwEAVievtSBO0OBPwk8P5R53GjpfNcHJ_OM5BWVkOuKOZEJyQnwBuYtsLmzlDLH68RTJ_jWfLElb-BAj2vClUut1royxql_Jbg74LTMFFJI-mWupJD7dRPnqrzpU-dio-RGZJOP9qQUB6Jf3-B3VhUCSO4Oz4iL0_VaangyH29h6bWTvyLRyrxbzcxtZwg'),
    http_header('Content-Type','application/json')
  ]),
  jsonb_build_object(
    'payment_channel',5,
    'portal_key','4b474a2c15affa36baa329e3c84c4d4',
    'order_number',p_booking_id::TEXT,
    'amount',p_amount,
    'payer_name',p_name,
    'payer_email',p_booking_id::TEXT||'@jbs.local',
    'payer_telephone_number',p_phone,
    'return_url',p_return_url
  )::TEXT,
  'application/json'
  ) AS http_response;

  v_url := v_response->>'url';
  
  IF v_url IS NULL THEN
    RAISE EXCEPTION 'Bayarcash payment creation failed: %', v_response;
  END IF;

  RETURN v_url;
END;
$$;
