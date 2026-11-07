import hashlib
import hmac
import secrets


def hash_password(password: str) -> str:
    salt = secrets.token_hex(16)
    result = hashlib.scrypt(password.encode(), salt=bytes.fromhex(salt), n=16384, r=8, p=5)
    return "scrypt-v1:" + salt + ":" + result.hex()


def verify_password(password: str, encoded: str) -> bool:
    try:
        scheme, salt, expected = encoded.split(":")
        if scheme != "scrypt-v1":
            return False
        result = hashlib.scrypt(password.encode(), salt=bytes.fromhex(salt), n=16384, r=8, p=5)
        return hmac.compare_digest(result.hex(), expected)
    except (ValueError, TypeError):
        return False


def token_hash(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()
