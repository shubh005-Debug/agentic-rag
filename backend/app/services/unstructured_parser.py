from unstructured.partition.pdf import partition_pdf


def extract_elements_from_pdf(file_path: str):
    elements = partition_pdf(
        filename=file_path,
        strategy="fast"
    )

    atomic_elements = []

    for element in elements:
        atomic_elements.append({
            "type": element.category,
            "text": str(element),
            "metadata": element.metadata.to_dict()
        })

    return atomic_elements