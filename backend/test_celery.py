from celery_app import celery_app


@celery_app.task
def add_numbers(a, b):
    return a + b