#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
aerolex/scripts/send-email-smtp.py
Despachador universal de correo electronico para Bot Juridico AeroLex.
Envia alertas procesales reales via Gmail SMTP SSL (puerto 465).
Cero emojis.
"""

import sys
import os
import json
import smtplib
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText

import io
from email.header import Header

def resolve_credentials():
    user = os.environ.get("AEROLEX_SMTP_USER") or os.environ.get("GMAIL_USER")
    pwd = os.environ.get("AEROLEX_SMTP_PASS") or os.environ.get("GMAIL_APP_PASS")
    
    if not pwd:
        possible_paths = [
            os.path.join(os.path.expanduser("~"), ".openmausbot", "email-secrets.json"),
            os.path.join(os.path.expanduser("~"), ".botjuridico", "email-secrets.json"),
            os.path.join(os.path.expanduser("~"), "Desktop", "AGENTES IA", "config_secrets.json"),
            os.path.join(os.getcwd(), "config_secrets.json"),
        ]
        for p in possible_paths:
            if os.path.exists(p):
                try:
                    with open(p, "r", encoding="utf-8-sig") as f:
                        data = json.load(f)
                        found_pwd = data.get("AEROLEX_SMTP_PASS") or data.get("pass") or data.get("GMAIL_APP_PASS")
                        found_user = data.get("AEROLEX_SMTP_USER") or data.get("user") or data.get("GMAIL_USER")
                        if found_user:
                            user = found_user
                        if found_pwd:
                            pwd = found_pwd
                            break
                except Exception:
                    pass

    if not user:
        user = "aerolex.cl@gmail.com"
        
    if pwd:
        pwd = pwd.replace(" ", "").strip()
                    
    return user, pwd


def main():
    # Asegurar decodificación UTF-8 pura en Windows
    if hasattr(sys.stdin, "reconfigure"):
        sys.stdin.reconfigure(encoding="utf-8")
        sys.stdout.reconfigure(encoding="utf-8")
    elif sys.stdin.buffer:
        sys.stdin = io.TextIOWrapper(sys.stdin.buffer, encoding="utf-8")
        sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8")

    try:
        raw_input = sys.stdin.read()
        if not raw_input.strip():
            print(json.dumps({"success": False, "error": "Entrada JSON vacia"}))
            sys.exit(1)
            
        payload = json.loads(raw_input)
        raw_recipient = payload.get("recipient") or payload.get("recipients") or "vidalparedes.jaime@gmail.com"
        if isinstance(raw_recipient, list):
            recipients_list = [str(r).strip() for r in raw_recipient if str(r).strip()]
        else:
            recipients_list = [r.strip() for r in str(raw_recipient).split(",") if r.strip()]
        if not recipients_list:
            recipients_list = ["vidalparedes.jaime@gmail.com"]

        subject = payload.get("subject") or "[ALERTA AEROLEX] Notificacion Procesal"
        text_body = payload.get("text") or ""
        html_body = payload.get("html") or ""
        
        user, pwd = resolve_credentials()
        if not pwd:
            print(json.dumps({"success": False, "error": "Credenciales SMTP no encontradas"}))
            sys.exit(1)
            
        msg = MIMEMultipart("alternative")
        msg["Subject"] = Header(subject, "utf-8").encode()
        msg["From"] = f"AeroLex Alertas Procesales <{user}>"
        msg["To"] = ", ".join(recipients_list)
        
        if text_body:
            msg.attach(MIMEText(text_body, "plain", "utf-8"))
        if html_body:
            msg.attach(MIMEText(html_body, "html", "utf-8"))
            
        with smtplib.SMTP_SSL("smtp.gmail.com", 465, timeout=15) as server:
            server.login(user, pwd)
            server.sendmail(user, recipients_list, msg.as_string())
            
        print(json.dumps({"success": True, "provider": "smtp", "recipient": ", ".join(recipients_list)}))
        sys.exit(0)
    except Exception as e:
        print(json.dumps({"success": False, "error": str(e)}))
        sys.exit(1)

if __name__ == "__main__":
    main()
