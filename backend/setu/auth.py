"""Section 21.3 — authentication + RBAC.

* Citizens: mobile number only — no OTP/code step. Signing in with a mobile
  number creates the account on first use and logs the same citizen back in
  on every later call.
* Operational roles (rescue / shelter / NGO / authority): email + password.
* Every protected route uses `require_roles(...)` — UI hiding is never the
  access control.
"""
import os
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional

import bcrypt
import jwt
from fastapi import Depends, HTTPException, Request
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from . import db
from .models import Role, clean

JWT_SECRET = os.environ.get("JWT_SECRET", "setu-dev-secret")
JWT_ALG = "HS256"
TOKEN_TTL_HOURS = 72

bearer = HTTPBearer(auto_error=False)


def hash_password(raw: str) -> str:
    return bcrypt.hashpw(raw.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")


def verify_password(raw: str, hashed: Optional[str]) -> bool:
    if not hashed:
        return False
    try:
        return bcrypt.checkpw(raw.encode("utf-8"), hashed.encode("utf-8"))
    except ValueError:
        return False


def make_token(user: Dict[str, Any]) -> str:
    payload = {
        "sub": user["userId"],
        "role": user.get("role", Role.USER.value),
        "exp": datetime.now(timezone.utc) + timedelta(hours=TOKEN_TTL_HOURS),
    }
    return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALG)


async def current_user(request: Request,
                      cred: Optional[HTTPAuthorizationCredentials] = Depends(bearer)) -> Dict[str, Any]:
    if not cred or not cred.credentials:
        raise HTTPException(status_code=401, detail="Authentication required")
    try:
        payload = jwt.decode(cred.credentials, JWT_SECRET, algorithms=[JWT_ALG])
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="Session expired — please sign in again")
    except jwt.PyJWTError:
        raise HTTPException(status_code=401, detail="Invalid token")
    user = await db.users.find_one({"userId": payload.get("sub")})
    if not user:
        raise HTTPException(status_code=401, detail="User no longer exists")
    return clean(user)


async def optional_user(request: Request,
                       cred: Optional[HTTPAuthorizationCredentials] = Depends(bearer)) -> Optional[Dict[str, Any]]:
    if not cred:
        return None
    try:
        return await current_user(request, cred)
    except HTTPException:
        return None


def require_roles(*roles: str):
    allowed = {r.value if isinstance(r, Role) else r for r in roles}

    async def dep(user: Dict[str, Any] = Depends(current_user)) -> Dict[str, Any]:
        if user.get("role") == Role.SUPER_ADMIN.value:
            return user
        if user.get("role") not in allowed:
            raise HTTPException(
                status_code=403,
                detail=f"Role {user.get('role')} is not permitted here (requires one of {sorted(allowed)})",
            )
        return user

    return dep


def public_user(user: Dict[str, Any]) -> Dict[str, Any]:
    """Strip secrets before returning a user object."""
    return {k: v for k, v in user.items() if k not in ("passwordHash", "_id")}


def is_admin(user: Optional[Dict[str, Any]]) -> bool:
    return bool(user) and user.get("role") in (Role.AUTHORITY.value, Role.SUPER_ADMIN.value)


OPERATIONAL_ROLES: List[str] = [
    Role.RESCUE_LEADER.value, Role.RESCUE_MEMBER.value, Role.SHELTER_ADMIN.value,
    Role.NGO_ADMIN.value, Role.AUTHORITY.value, Role.SUPER_ADMIN.value,
]
