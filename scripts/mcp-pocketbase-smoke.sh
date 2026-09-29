#!/usr/bin/env bash

set -euo pipefail

HELPERS="scripts/make_helpers.sh"

if [ ! -f "$HELPERS" ]; then
  echo "Run this script from the repository root." >&2
  exit 1
fi

source "$HELPERS"
requested_pb_url="${PB_URL:-}"
requested_admin_email="${PB_ADMIN_EMAIL:-}"
requested_admin_password="${PB_ADMIN_PASSWORD:-}"
requested_service_email="${POCKETBASE_SERVICE_USER_EMAIL:-}"
requested_service_password="${POCKETBASE_SERVICE_USER_PASSWORD:-}"
load_env_file

PB_URL="${requested_pb_url:-$PB_URL}"
PB_ADMIN_EMAIL="${requested_admin_email:-$PB_ADMIN_EMAIL}"
PB_ADMIN_PASSWORD="${requested_admin_password:-$PB_ADMIN_PASSWORD}"
POCKETBASE_SERVICE_USER_EMAIL="${requested_service_email:-$POCKETBASE_SERVICE_USER_EMAIL}"
POCKETBASE_SERVICE_USER_PASSWORD="${requested_service_password:-${POCKETBASE_SERVICE_USER_PASSWORD:-}}"

service_password="${POCKETBASE_SERVICE_USER_PASSWORD:-$(random_secret 18)}"
owner_email="mcp-smoke-owner-$$@resumate.local"
owner_password="$(random_secret 18)"
other_email="mcp-smoke-other-$$@resumate.local"
other_password="$(random_secret 18)"
profile_id=""
owner_id=""
other_id=""
metadata_id=""
document_id=""
private_image_id=""
public_image_id=""
project_id=""
skill_id=""

cleanup() {
  local token
  token="$(pb_admin_token 2>/dev/null || true)"
  if [ -z "$token" ]; then
    return
  fi

  if [ -n "$profile_id" ]; then
    pb_delete_record "$token" cv_profiles "$profile_id" 2>/dev/null || true
  fi

  if [ -n "$project_id" ]; then
    pb_delete_record "$token" projects "$project_id" 2>/dev/null || true
  fi
  if [ -n "$skill_id" ]; then
    pb_delete_record "$token" skills "$skill_id" 2>/dev/null || true
  fi

  for file_id in "$document_id" "$private_image_id" "$public_image_id"; do
    if [ -n "$file_id" ]; then
      pb_delete_record "$token" files "$file_id" 2>/dev/null || true
    fi
  done

  if [ -n "$metadata_id" ]; then
    pb_delete_record "$token" profile_metadata "$metadata_id" 2>/dev/null || true
  fi

  if [ -n "$owner_id" ]; then
    pb_delete_record "$token" users "$owner_id" 2>/dev/null || true
  fi

  if [ -n "$other_id" ]; then
    pb_delete_record "$token" users "$other_id" 2>/dev/null || true
  fi
}
trap cleanup EXIT
trap 'echo "PocketBase MCP smoke test failed at line $LINENO." >&2' ERR

for attempt in $(seq 1 120); do
  if curl -fsS "$PB_URL/api/health" >/dev/null 2>&1; then
    break
  fi

  if [ "$attempt" = "120" ]; then
    echo "PocketBase did not become healthy at $PB_URL." >&2
    exit 1
  fi

  sleep 1
done

admin_token="$(pb_admin_token)"

service_id="$(pb_find_first_id "$admin_token" users "email=\"$POCKETBASE_SERVICE_USER_EMAIL\"")"
service_body="$(jq -cn \
  --arg email "$POCKETBASE_SERVICE_USER_EMAIL" \
  --arg password "$service_password" \
  '{email: $email, password: $password, passwordConfirm: $password, verified: true, emailVisibility: false, firstName: "MCP", lastName: "Service", name: "MCP Service", isMcpServiceAccount: true}')"

if [ -n "$service_id" ]; then
  pb_patch_record "$admin_token" users "$service_id" "$service_body"
else
  pb_create_record "$admin_token" users "$service_body" >/dev/null
fi

service_auth="$(curl -fsS -X POST "$PB_URL/api/collections/users/auth-with-password" \
  -H 'Content-Type: application/json' \
  --data "$(jq -cn --arg identity "$POCKETBASE_SERVICE_USER_EMAIL" --arg password "$service_password" '{identity: $identity, password: $password}')")"
service_token="$(printf '%s' "$service_auth" | jq -r '.token // empty')"

if [ -z "$service_token" ]; then
  echo 'MCP service user authentication failed.' >&2
  exit 1
fi

owner_body="$(jq -cn \
  --arg email "$owner_email" \
  --arg password "$owner_password" \
  '{email: $email, password: $password, passwordConfirm: $password, verified: true, emailVisibility: false, firstName: "Smoke", lastName: "Owner", name: "Smoke Owner"}')"
owner_id="$(pb_create_record "$admin_token" users "$owner_body" | jq -r '.id')"

owner_auth="$(curl -fsS -X POST "$PB_URL/api/collections/users/auth-with-password" \
  -H 'Content-Type: application/json' \
  --data "$(jq -cn --arg identity "$owner_email" --arg password "$owner_password" '{identity: $identity, password: $password}')")"
owner_token="$(printf '%s' "$owner_auth" | jq -r '.token // empty')"

other_body="$(jq -cn \
  --arg email "$other_email" \
  --arg password "$other_password" \
  '{email: $email, password: $password, passwordConfirm: $password, verified: true, emailVisibility: false, firstName: "Smoke", lastName: "Other", name: "Smoke Other"}')"
other_id="$(pb_create_record "$admin_token" users "$other_body" | jq -r '.id')"
other_auth="$(curl -fsS -X POST "$PB_URL/api/collections/users/auth-with-password" \
  -H 'Content-Type: application/json' \
  --data "$(jq -cn --arg identity "$other_email" --arg password "$other_password" '{identity: $identity, password: $password}')")"
other_token="$(printf '%s' "$other_auth" | jq -r '.token // empty')"

if [ -z "$owner_token" ] || [ -z "$other_token" ]; then
  echo 'Smoke test user authentication failed.' >&2
  exit 1
fi

metadata_response="$(curl -fsS -X POST "$PB_URL/api/collections/profile_metadata/records" \
  -H "Authorization: Bearer $owner_token" \
  -H 'Content-Type: application/json' \
  --data "$(jq -cn --arg ownerId "$owner_id" '{user: $ownerId, writingStyleDescription: "Smoke style", writingStyleUrl: "https://example.test/style"}')")"
metadata_id="$(printf '%s' "$metadata_response" | jq -r '.id // empty')"

service_metadata_status="$(curl -sS -o /dev/null -w '%{http_code}' \
  -H "Authorization: Bearer $service_token" \
  "$PB_URL/api/collections/profile_metadata/records/$metadata_id")"
service_user_status="$(curl -sS -o /dev/null -w '%{http_code}' \
  -H "Authorization: Bearer $service_token" \
  "$PB_URL/api/collections/users/records/$owner_id")"

if [ "$service_metadata_status" != "404" ] || [ "$service_user_status" != "404" ]; then
  echo "MCP service account unexpectedly accessed owner metadata or user records." >&2
  exit 1
fi

curl -fsS \
  -H "Authorization: Bearer $owner_token" \
  "$PB_URL/api/collections/profile_metadata/records/$metadata_id" \
  | jq -e '.writingStyleDescription == "Smoke style"' >/dev/null

slug="classic--mcp-smoke-$(date +%s)-$$"
profile_body="$(jq -cn \
  --arg slug "$slug" \
  --arg ownerId "$owner_id" \
  '{slug: $slug, label: "MCP Smoke - Classic", profileName: "MCP Smoke Profile", template: "classic", status: "sent", public: true, user: $ownerId, professionalSummary: "Smoke test profile.", skills: [], jobs: [], projects: [], achievements: [], degrees: [], hobbies: [], extra: {}}')"
profile_response="$(curl -fsS -X POST "$PB_URL/api/collections/cv_profiles/records" \
  -H "Authorization: Bearer $service_token" \
  -H 'Content-Type: application/json' \
  --data "$profile_body")"

profile_id="$(printf '%s' "$profile_response" | jq -r '.id // empty')"

if [ -z "$profile_id" ]; then
  echo 'Smoke profile creation did not return an id.' >&2
  printf '%s\n' "$profile_response" >&2
  exit 1
fi

if ! printf '%s' "$profile_response" | jq -e \
  '.label == "MCP Smoke - Classic" and .status == "sent" and .profileName == "MCP Smoke Profile" and .template == "classic" and .public == true and .user != ""' \
  >/dev/null; then
  echo 'Smoke profile response did not match the expected contract.' >&2
  printf '%s\n' "$profile_response" >&2
  exit 1
fi

public_cv_url="$PB_URL/api/custom/cv-data/by-slug/$slug"
direct_cv_url="$PB_URL/api/collections/cv_profiles/records/$profile_id"

for url in "$public_cv_url" "$direct_cv_url"; do
  anonymous_response="$(curl -fsS "$url")"
  outsider_response="$(curl -fsS "$url" -H "Authorization: Bearer $other_token")"
  owner_response="$(curl -fsS "$url" -H "Authorization: Bearer $owner_token")"
  service_response="$(curl -fsS "$url" -H "Authorization: Bearer $service_token")"

  if [ "$url" = "$public_cv_url" ]; then
    public_check='.profile | (has("label") | not) and (has("status") | not)'
    private_check='.profile.label == "MCP Smoke - Classic" and .profile.status == "sent"'
  else
    public_check='(has("label") | not) and (has("status") | not)'
    private_check='.label == "MCP Smoke - Classic" and .status == "sent"'
  fi

  for audience in anonymous outsider owner service; do
    case "$audience" in
      anonymous) response="$anonymous_response"; check="$public_check" ;;
      outsider) response="$outsider_response"; check="$public_check" ;;
      owner) response="$owner_response"; check="$private_check" ;;
      service) response="$service_response"; check="$private_check" ;;
    esac
    if ! printf '%s' "$response" | jq -e "$check" >/dev/null; then
      echo "Public CV metadata isolation failed for $audience on $(basename "$url")." >&2
      exit 1
    fi
  done
done

# Three independent uploads: a document, a private image, and an image to be
# explicitly included on the public profile. Never print returned file tokens.
document_response="$(printf 'private smoke document' | curl -fsS -X POST \
  "$PB_URL/api/collections/files/records" -H "Authorization: Bearer $owner_token" \
  -F "user=$owner_id" -F 'kind=document' \
  -F 'file=@-;filename=private-smoke.pdf;type=application/pdf')"
document_id="$(printf '%s' "$document_response" | jq -r '.id // empty')"
private_image_response="$(printf '<svg xmlns="http://www.w3.org/2000/svg"/>' | curl -fsS -X POST \
  "$PB_URL/api/collections/files/records" -H "Authorization: Bearer $owner_token" \
  -F "user=$owner_id" -F 'kind=image' \
  -F 'file=@-;filename=private-smoke.svg;type=image/svg+xml')"
private_image_id="$(printf '%s' "$private_image_response" | jq -r '.id // empty')"
public_image_response="$(printf '<svg xmlns="http://www.w3.org/2000/svg"/>' | curl -fsS -X POST \
  "$PB_URL/api/collections/files/records" -H "Authorization: Bearer $owner_token" \
  -F "user=$owner_id" -F 'kind=image' \
  -F 'file=@-;filename=public-smoke.svg;type=image/svg+xml')"
public_image_id="$(printf '%s' "$public_image_response" | jq -r '.id // empty')"

if [ -z "$document_id" ] || [ -z "$private_image_id" ] || [ -z "$public_image_id" ]; then
  echo 'Smoke test file uploads failed.' >&2
  exit 1
fi

pb_patch_record "$admin_token" cv_profiles "$profile_id" "$(jq -cn --arg id "$public_image_id" '{profilePictureFile: $id}')"
document_url="$PB_URL/api/files/$(printf '%s' "$document_response" | jq -r '.collectionId')/$document_id/$(printf '%s' "$document_response" | jq -r '.file')"
private_image_url="$PB_URL/api/files/$(printf '%s' "$private_image_response" | jq -r '.collectionId')/$private_image_id/$(printf '%s' "$private_image_response" | jq -r '.file')"
public_image_url="$PB_URL/api/files/$(printf '%s' "$public_image_response" | jq -r '.collectionId')/$public_image_id/$(printf '%s' "$public_image_response" | jq -r '.file')"

owner_picture_response="$(printf '<svg xmlns="http://www.w3.org/2000/svg"/>' | curl -fsS -X PATCH \
  "$PB_URL/api/collections/users/records/$owner_id" -H "Authorization: Bearer $owner_token" \
  -F 'profilePicture=@-;filename=owner-picture.svg;type=image/svg+xml')"
owner_avatar_response="$(printf '<svg xmlns="http://www.w3.org/2000/svg"/>' | curl -fsS -X PATCH \
  "$PB_URL/api/collections/users/records/$owner_id" -H "Authorization: Bearer $owner_token" \
  -F 'avatar=@-;filename=private-avatar.svg;type=image/svg+xml')"
owner_picture_url="$PB_URL/api/files/$(printf '%s' "$owner_picture_response" | jq -r '.collectionId')/$owner_id/$(printf '%s' "$owner_picture_response" | jq -r '.profilePicture')"
owner_avatar_url="$PB_URL/api/files/$(printf '%s' "$owner_avatar_response" | jq -r '.collectionId')/$owner_id/$(printf '%s' "$owner_avatar_response" | jq -r '.avatar')"

project_response="$(printf '<svg xmlns="http://www.w3.org/2000/svg"/>' | curl -fsS -X POST \
  "$PB_URL/api/collections/projects/records" -H "Authorization: Bearer $owner_token" \
  -F "user=$owner_id" -F 'name=Public smoke project' -F "file=$private_image_id" \
  -F 'picture=@-;filename=project-picture.svg;type=image/svg+xml')"
project_id="$(printf '%s' "$project_response" | jq -r '.id // empty')"
if [ "$(printf '%s' "$project_response" | jq -r '.file // empty')" != "$private_image_id" ]; then
  echo 'Project file relation was not saved.' >&2
  exit 1
fi
project_picture_url="$PB_URL/api/files/$(printf '%s' "$project_response" | jq -r '.collectionId')/$project_id/$(printf '%s' "$project_response" | jq -r '.picture')"
skill_response="$(printf '<svg xmlns="http://www.w3.org/2000/svg"/>' | curl -fsS -X POST \
  "$PB_URL/api/collections/skills/records" -H "Authorization: Bearer $owner_token" \
  -F "user=$owner_id" -F 'name=Public smoke skill' \
  -F 'icon=@-;filename=skill-icon.svg;type=image/svg+xml')"
skill_id="$(printf '%s' "$skill_response" | jq -r '.id // empty')"
skill_icon_url="$PB_URL/api/files/$(printf '%s' "$skill_response" | jq -r '.collectionId')/$skill_id/$(printf '%s' "$skill_response" | jq -r '.icon')"

if [ -z "$project_id" ] || [ -z "$skill_id" ]; then
  echo 'Smoke test project or skill setup failed.' >&2
  exit 1
fi

pb_patch_record "$admin_token" cv_profiles "$profile_id" "$(jq -cn --arg project "$project_id" --arg skill "$skill_id" '{projects: [$project], skills: [$skill]}')"
if ! curl -fsS "$public_cv_url" | jq -e --arg project "$project_id" --arg skill "$skill_id" \
  '.profile.collectionId != "" and .user.collectionId != "" and .profile.expand.profilePictureFile.collectionId != "" and .projects[0].collectionId != "" and .skills[0].collectionId != "" and .projects[0].id == $project and .skills[0].id == $skill' \
  >/dev/null; then
  echo 'Public CV file records are missing collection IDs for SDK image URLs.' >&2
  exit 1
fi

file_token="$(curl -fsS -X POST "$PB_URL/api/files/token" -H "Authorization: Bearer $owner_token" | jq -r '.token // empty')"
other_file_token="$(curl -fsS -X POST "$PB_URL/api/files/token" -H "Authorization: Bearer $other_token" | jq -r '.token // empty')"

file_status() {
  curl -sS -o /dev/null -w '%{http_code}' "$1"
}

expect_file_status() {
  local expected="$1" actual
  actual="$(file_status "$2")"
  if [ "$actual" != "$expected" ]; then
    echo "Unexpected file access for $(basename "${2%%\?*}"): expected HTTP $expected, received $actual." >&2
    exit 1
  fi
}

expect_file_status 404 "$document_url"
expect_file_status 200 "$private_image_url"
expect_file_status 200 "$public_image_url"
expect_file_status 200 "$owner_picture_url"
expect_file_status 404 "$owner_avatar_url"
expect_file_status 200 "$project_picture_url"
expect_file_status 200 "$skill_icon_url"
expect_file_status 200 "$document_url?token=$file_token"
expect_file_status 200 "$private_image_url?token=$file_token"
expect_file_status 200 "$owner_avatar_url?token=$file_token"
expect_file_status 404 "$document_url?token=$other_file_token"
expect_file_status 404 "$document_url?token=invalid"

pb_patch_record "$admin_token" cv_profiles "$profile_id" '{"profilePictureFile": ""}'
expect_file_status 404 "$public_image_url"
pb_patch_record "$admin_token" cv_profiles "$profile_id" "$(jq -cn --arg id "$public_image_id" '{profilePictureFile: $id}')"
pb_patch_record "$admin_token" cv_profiles "$profile_id" '{"projects": [], "skills": []}'
if ! curl -fsS "$public_cv_url" | jq -e '(.projects | length) == 0 and (.skills | length) == 0' >/dev/null; then
  echo 'Public CV still references removed projects or skills.' >&2
  exit 1
fi
expect_file_status 404 "$private_image_url"
expect_file_status 404 "$private_image_url?token=invalid"
expect_file_status 404 "$project_picture_url"
expect_file_status 404 "$skill_icon_url"

# Honor the configured token lifetime (which may differ between deployments).
# Keep the default smoke test fast, but allow full expiry checks.
if [ "${CHECK_FILE_TOKEN_EXPIRY:-0}" = '1' ]; then
  expires_at="$(printf '%s' "$file_token" | jq -Rr 'split(".")[1] | gsub("-"; "+") | gsub("_"; "/") | @base64d | fromjson | .exp')"
  sleep_seconds="$((expires_at - $(date +%s) + 2))"
  if [ "$sleep_seconds" -gt 0 ]; then
    sleep "$sleep_seconds"
  fi
  expect_file_status 404 "$document_url?token=$file_token"
fi

pb_patch_record "$admin_token" cv_profiles "$profile_id" '{"public": false}'
expect_file_status 404 "$public_image_url"
expect_file_status 404 "$owner_picture_url"
if [ "$(file_status "$direct_cv_url")" != '404' ] || [ "$(file_status "$public_cv_url")" != '401' ]; then
  echo 'Private CV is accessible without authentication.' >&2
  exit 1
fi

echo "PocketBase MCP smoke profile created successfully: $profile_id"
