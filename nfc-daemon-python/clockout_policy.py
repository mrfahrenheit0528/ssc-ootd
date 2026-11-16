"""The versioned Supabase clock-out rule, cached for offline attendance."""
from datetime import datetime, time, timedelta
from zoneinfo import ZoneInfo

SCHOOL_ZONE = ZoneInfo('Asia/Manila')


def validate_policy(value):
    if value is None:
        return None
    if not isinstance(value, dict) or value.get('version') != 1:
        raise ValueError('Unsupported automatic clock-out policy; refresh after updating Supabase.')
    activated = datetime.fromisoformat(value['effective_from'].replace('Z', '+00:00'))
    if activated.tzinfo is None:
        raise ValueError('The automatic clock-out activation time must include a timezone.')
    return {'version': 1, 'effective_from': activated.isoformat()}


def clockout_times(clock_in, policy=None, close_time='21:00'):
    local = clock_in.astimezone(SCHOOL_ZONE)
    cutoff = datetime.combine(local.date(), time.fromisoformat(close_time), SCHOOL_ZONE)
    legacy = max(cutoff, clock_in + timedelta(microseconds=1))
    policy = validate_policy(policy)
    if policy is None or clock_in < datetime.fromisoformat(policy['effective_from']):
        return legacy, legacy
    five = datetime.combine(local.date(), time(17), SCHOOL_ZONE)
    if local.time().replace(tzinfo=None) > time(17):
        estimated = clock_in + timedelta(hours=1)
        return max(cutoff, estimated), estimated
    return cutoff, max(five, clock_in + timedelta(microseconds=1))
