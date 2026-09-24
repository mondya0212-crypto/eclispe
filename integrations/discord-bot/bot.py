import os
import json
import urllib.request
import urllib.error
from datetime import datetime, timezone

import discord
from discord.ext import commands

TOKEN = os.environ["DISCORD_BOT_TOKEN"]
API_URL = os.environ["ECLIPSE_API_URL"].rstrip("/") + "/api/integrations/attendance"
INTEGRATION_TOKEN = os.environ["ECLIPSE_INTEGRATION_TOKEN"]
PREFIX = os.getenv("DISCORD_PREFIX", "ㅍ")
# Optional JSON mapping: {"DISCORD_USER_ID":"게임닉네임"}
ALIASES = json.loads(os.getenv("MEMBER_ALIASES_JSON", "{}"))

intents = discord.Intents.default()
intents.message_content = True
bot = commands.Bot(command_prefix=PREFIX, intents=intents, help_command=None)


def post_attendance(member_name: str, user: discord.abc.User, status: str = "present"):
    payload = json.dumps({
        "member_name": member_name,
        "discord_user_id": str(user.id),
        "discord_display_name": getattr(user, "display_name", user.name),
        "attendance_date": datetime.now().astimezone().strftime("%Y-%m-%d"),
        "status": status,
    }).encode("utf-8")
    req = urllib.request.Request(API_URL, data=payload, method="POST", headers={
        "Content-Type": "application/json",
        "x-eclipse-integration-token": INTEGRATION_TOKEN,
    })
    try:
        with urllib.request.urlopen(req, timeout=10) as res:
            return json.loads(res.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        try:
            body = e.read().decode("utf-8")
        except Exception:
            body = str(e)
        raise RuntimeError(body)


def resolve_name(user: discord.abc.User) -> str:
    return ALIASES.get(str(user.id), getattr(user, "display_name", user.name)).strip()


@bot.event
async def on_ready():
    print(f"ECLIPSE 출석봇 로그인: {bot.user}")


@bot.command(name="출석")
async def attendance(ctx):
    name = resolve_name(ctx.author)
    try:
        post_attendance(name, ctx.author)
        await ctx.reply(f"✅ **{name}**님 출석 완료!", mention_author=False)
    except RuntimeError as e:
        await ctx.reply(f"❌ 출석 실패: {e}", mention_author=False)


@bot.command(name="출석취소")
async def attendance_cancel(ctx):
    # 상태를 absent로 기록해 오늘 출석을 취소한다.
    name = resolve_name(ctx.author)
    try:
        post_attendance(name, ctx.author, "absent")
        await ctx.reply(f"↩️ **{name}**님 오늘 출석을 취소했습니다.", mention_author=False)
    except RuntimeError as e:
        await ctx.reply(f"❌ 출석 취소 실패: {e}", mention_author=False)


@bot.command(name="출석현황")
async def attendance_status(ctx):
    await ctx.reply("📋 출석 현황은 ECLIPSE 길드 관리 페이지의 '참여율 기록'에서 확인해주세요.", mention_author=False)


@bot.command(name="도움말")
async def help_cmd(ctx):
    await ctx.reply(f"`{PREFIX}출석` / `{PREFIX}출석취소` / `{PREFIX}출석현황`", mention_author=False)

bot.run(TOKEN)
